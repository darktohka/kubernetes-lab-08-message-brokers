// tryAssign(): turn queued requests into missions on free drones.
//
// Safety with 2 replicas:
//  - `pg_try_advisory_xact_lock(918274)` serialises the whole assignment step
//    across pods, so two replicas can never hand the same drone to two requests.
//  - Queued rows are claimed with FOR UPDATE SKIP LOCKED.
//  - Drones referenced by an active mission in this DB are never reused.
import { errMessage, log } from "./config.ts";
import { sql } from "./db.ts";
import { fetchDrones } from "./clients.ts";
import type { Drone } from "./clients.ts";
import { TOPIC_DRONE_COMMANDS, publishWithRetry } from "./kafka.ts";
import { broadcastState } from "./sse.ts";
import { ACTIVE_MISSION_STATUSES } from "./wire.ts";
import type { MissionRow, MissionStatus, RequestRow } from "./wire.ts";

const ASSIGN_LOCK_KEY = 918274;
const MAX_PENDING_COMMANDS = 200;

interface AssignCommand {
  commandId: string;
  type: "assign";
  droneId: string;
  missionId: string;
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  agent: string | null;
  at: string;
}

let inFlight = false;

/**
 * Assign commands that could not be published (Kafka briefly down). They are
 * retried by the 5 s reconciler; the mission row itself is already committed, so
 * a lost command only means drone-management learns the new state at the first
 * phase-change PATCH instead of immediately.
 */
const pendingCommands: AssignCommand[] = [];

function queueForRetry(command: AssignCommand): void {
  if (pendingCommands.some((entry) => entry.commandId === command.commandId)) return;
  if (pendingCommands.length >= MAX_PENDING_COMMANDS) {
    const dropped = pendingCommands.shift();
    log("error", `command retry queue full, dropping command ${dropped?.commandId ?? "?"}`);
  }
  pendingCommands.push(command);
}

async function flushPendingCommands(): Promise<void> {
  while (pendingCommands.length > 0) {
    const command = pendingCommands[0];
    const rows = await sql<{ status: MissionStatus }[]>`
      SELECT status FROM missions WHERE id = ${command.missionId} LIMIT 1
    `;
    const status = rows[0]?.status;
    if (!status || status === "done" || status === "cancelled") {
      // Mission is over: a late assign command would only confuse the drone.
      pendingCommands.shift();
      continue;
    }
    if (!(await publishWithRetry(TOPIC_DRONE_COMMANDS, command.droneId, command, 3))) {
      return; // Kafka still down, try again on the next tick
    }
    pendingCommands.shift();
    log("info", `re-published queued assign command for mission ${command.missionId}`);
  }
}

/** Every 5 s, on a new Kafka request, and when a drone reports `idle`. */
export async function tryAssign(reason: string): Promise<void> {
  // In-process guard; the advisory lock covers the cross-replica case.
  if (inFlight) return;
  inFlight = true;
  try {
    await assignOnce(reason);
  } catch (error) {
    log("error", `tryAssign(${reason}) failed: ${errMessage(error)}`);
  } finally {
    inFlight = false;
  }
}

async function assignOnce(reason: string): Promise<void> {
  const commands: AssignCommand[] = [];
  let changed = false;

  await sql.begin(async (tx) => {
    const lockRows = await tx<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${ASSIGN_LOCK_KEY}) AS locked
    `;
    if (lockRows[0]?.locked !== true) {
      // Another replica is assigning right now; it will pick these requests up.
      return;
    }

    const requests = await tx<RequestRow[]>`
      SELECT * FROM schedule_requests
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 5
      FOR UPDATE SKIP LOCKED
    `;
    if (requests.length === 0) return;

    const drones = await fetchDrones();
    if (drones === null) {
      log("warn", `tryAssign(${reason}): drone service unavailable, leaving requests queued`);
      return;
    }

    const busyRows = await tx<{ drone_id: string }[]>`
      SELECT DISTINCT drone_id FROM missions
      WHERE status IN ${tx(ACTIVE_MISSION_STATUSES)}
    `;
    const busy = new Set(busyRows.map((row) => row.drone_id));

    // Only drones that are idle *and* not already flying a mission in this DB.
    const freePool: Drone[] = drones.filter(
      (drone) => drone.status === "idle" && !busy.has(drone.id),
    );

    for (const request of requests) {
      const existing = await tx<{ drone_id: string }[]>`
        SELECT drone_id FROM missions WHERE request_id = ${request.id}
      `;
      const droneCount = Math.max(1, request.drone_count);
      const stillNeeded = Math.max(0, droneCount - existing.length);

      if (stillNeeded > 0 && freePool.length > 0) {
        const chosen = freePool.splice(0, stillNeeded);
        for (const drone of chosen) {
          const missionId = crypto.randomUUID();
          const inserted = await tx<{ id: string }[]>`
            INSERT INTO missions (
              id, request_id, drone_id, drone_name,
              location_id, location_name, lat, lng, agent,
              status, progress, lat_now, lng_now, battery, battery_start,
              started_at, phase_started_at
            ) VALUES (
              ${missionId}, ${request.id}, ${drone.id}, ${drone.name},
              ${request.location_id}, ${request.location_name}, ${request.lat}, ${request.lng},
              ${request.agent},
              'assigned', 0, ${drone.lat}, ${drone.lng}, ${drone.battery}, ${drone.battery},
              now(), now()
            )
            ON CONFLICT (request_id, drone_id) DO NOTHING
            RETURNING id
          `;
          if (inserted.length === 0) continue;

          commands.push({
            commandId: crypto.randomUUID(),
            type: "assign",
            droneId: drone.id,
            missionId,
            locationId: request.location_id,
            locationName: request.location_name,
            lat: request.lat,
            lng: request.lng,
            agent: request.agent,
            at: new Date().toISOString(),
          });
        }
      }

      // Count from the DB so partially-assigned requests are handled too.
      const finalCount = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM missions WHERE request_id = ${request.id}
      `;
      if ((finalCount[0]?.count ?? 0) >= droneCount) {
        const updated = await tx`
          UPDATE schedule_requests SET status = 'assigned'
          WHERE id = ${request.id} AND status = 'queued'
        `;
        if (updated.count > 0) {
          changed = true;
          log(
            "info",
            `request ${request.id} assigned (${finalCount[0]?.count ?? 0}/${droneCount} missions) [${reason}]`,
          );
        }
      }
    }
  });

  // Publish only after COMMIT, so a rolled-back transaction never emits commands.
  for (const command of commands) {
    const ok = await publishWithRetry(TOPIC_DRONE_COMMANDS, command.droneId, command, 3);
    if (!ok) {
      log("error", `assign command for mission ${command.missionId} could not be published`);
      queueForRetry(command);
    }
  }
  if (commands.length > 0) changed = true;

  await flushPendingCommands();

  if (changed) await broadcastState();
}
