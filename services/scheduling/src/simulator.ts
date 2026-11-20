// Mission simulator. Exactly one replica is active: it holds the session-level
// Postgres advisory lock 918273 on a dedicated connection for its lifetime.
//
// Timeline (deterministic, derived from missions.started_at so a restart or
// leader failover resumes mid-flight instead of restarting the mission):
//   assigned 18 s -> enroute 18 s -> spraying 30 s -> returning 18 s -> done
import postgres from "postgres";
import { DATABASE_URL, errMessage, log } from "./config.ts";
import { sql } from "./db.ts";
import { patchDrone } from "./clients.ts";
import { publishPosition } from "./redis.ts";
import { broadcastState } from "./sse.ts";
import type { MissionRow, MissionStatus } from "./wire.ts";

export const HOME_LAT = 46.5386;
export const HOME_LNG = 24.5578;

const SIMULATOR_LOCK_KEY = 918273;
const TICK_MS = 1000;
const ELECTION_RETRY_MS = 10_000;

const ASSIGNED_MS = 18_000;
const ENROUTE_MS = 18_000;
const SPRAYING_MS = 30_000;
const RETURNING_MS = 18_000;

/** Flight (battery-draining) time starts when enroute begins. */
const FLIGHT_START_MS = ASSIGNED_MS;

const BATTERY_DRAIN_PER_SECOND = 0.5; // ~1 point per 2 s
const BATTERY_FLOOR = 5;
const SPRAY_RADIUS_M = 120;
const METERS_PER_DEGREE_LAT = 111_320;

/** Concurrent drones on one plot must not overlap on the map. */
const LANE_MIN_RADIUS_M = 90;
const LANE_MAX_RADIUS_M = 220;

/** FNV-1a, so the lane is stable across restarts and replicas. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic lateral offset for a mission, derived from its drone id:
 * an angle (0..2pi) plus a radius in 90..220 m. The mission's `lat`/`lng`
 * columns stay the true plot centre; the offset is applied only to the flown
 * track (enroute target, spraying centre, return origin).
 */
function laneOffset(
  droneId: string,
  plotLat: number,
): { dLat: number; dLng: number; radiusM: number } {
  const hash = fnv1a(droneId);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const radiusM =
    LANE_MIN_RADIUS_M + ((hash >>> 12) % (LANE_MAX_RADIUS_M - LANE_MIN_RADIUS_M + 1));
  const metresPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(0.1, Math.cos((plotLat * Math.PI) / 180));
  return {
    dLat: (radiusM / METERS_PER_DEGREE_LAT) * Math.cos(angle),
    dLng: (radiusM / metresPerDegreeLng) * Math.sin(angle),
    radiusM,
  };
}

const PHASES: { status: MissionStatus; durationMs: number }[] = [
  { status: "assigned", durationMs: ASSIGNED_MS },
  { status: "enroute", durationMs: ENROUTE_MS },
  { status: "spraying", durationMs: SPRAYING_MS },
  { status: "returning", durationMs: RETURNING_MS },
];

// Dedicated single-connection pool: the advisory lock lives on this connection.
const lockSql = postgres(DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 0,
  onnotice: () => {},
});

type ReservedConnection = Awaited<ReturnType<typeof lockSql.reserve>>;

let leaderConn: ReservedConnection | null = null;
let isLeader = false;
let notLeaderLogged = false;
let tickBusy = false;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function batteryAt(mission: MissionRow, elapsedMs: number): number {
  const start = mission.battery_start ?? mission.battery ?? 100;
  const flyingSeconds = Math.max(0, elapsedMs - FLIGHT_START_MS) / 1000;
  const drained = Math.round(start - BATTERY_DRAIN_PER_SECOND * flyingSeconds);
  return Math.max(BATTERY_FLOOR, Math.min(100, drained));
}

interface PhaseView {
  status: MissionStatus;
  /** 0..1 within the current phase. */
  progress: number;
  /** Absolute start of the current phase. */
  phaseStartMs: number;
  lat: number;
  lng: number;
  battery: number;
}

function viewFor(mission: MissionRow, nowMs: number): PhaseView | null {
  const startedMs = new Date(mission.started_at).getTime();
  const elapsed = Math.max(0, nowMs - startedMs);
  const battery = batteryAt(mission, elapsed);

  let offset = 0;
  for (const phase of PHASES) {
    if (elapsed < offset + phase.durationMs) {
      const t = clamp01((elapsed - offset) / phase.durationMs);
      const { lat, lng } = positionFor(mission, phase.status, t);
      return {
        status: phase.status,
        progress: Number(t.toFixed(4)),
        phaseStartMs: startedMs + offset,
        lat,
        lng,
        battery,
      };
    }
    offset += phase.durationMs;
  }
  return null; // timeline finished
}

function positionFor(
  mission: MissionRow,
  status: MissionStatus,
  t: number,
): { lat: number; lng: number } {
  if (status === "assigned") {
    // Sit still where the drone actually is until the flight starts.
    return {
      lat: mission.lat_now ?? HOME_LAT,
      lng: mission.lng_now ?? HOME_LNG,
    };
  }

  // Every mission gets its own lane around the plot (see laneOffset), so two
  // drones on the same plot never render on top of each other.
  const lane = laneOffset(mission.drone_id, mission.lat);
  const targetLat = mission.lat + lane.dLat;
  const targetLng = mission.lng + lane.dLng;

  if (status === "enroute") {
    // home -> lane entry point next to the plot
    return {
      lat: lerp(HOME_LAT, targetLat, t),
      lng: lerp(HOME_LNG, targetLng, t),
    };
  }
  if (status === "spraying") {
    // Two small circles (~120 m radius) around this mission's lane centre.
    const angle = t * Math.PI * 4;
    const latRad = (targetLat * Math.PI) / 180;
    const metresPerDegreeLng = METERS_PER_DEGREE_LAT * Math.max(0.1, Math.cos(latRad));
    return {
      lat: targetLat + (SPRAY_RADIUS_M / METERS_PER_DEGREE_LAT) * Math.cos(angle),
      lng: targetLng + (SPRAY_RADIUS_M / metresPerDegreeLng) * Math.sin(angle),
    };
  }
  // returning: lane centre -> home
  return {
    lat: lerp(targetLat, HOME_LAT, t),
    lng: lerp(targetLng, HOME_LNG, t),
  };
}

async function completeRequestIfDone(requestId: string): Promise<void> {
  try {
    await sql`
      UPDATE schedule_requests SET status = 'done'
      WHERE id = ${requestId}
        AND status = 'assigned'
        AND NOT EXISTS (
          SELECT 1 FROM missions
          WHERE request_id = ${requestId} AND status NOT IN ('done', 'cancelled')
        )
    `;
  } catch (error) {
    log("warn", `could not close request ${requestId}: ${errMessage(error)}`);
  }
}

/** Advances one mission. Returns true when its status changed. */
async function advance(mission: MissionRow): Promise<boolean> {
  const nowMs = Date.now();
  const view = viewFor(mission, nowMs);

  if (view === null) {
    const battery = batteryAt(mission, nowMs - new Date(mission.started_at).getTime());
    await sql`
      UPDATE missions SET
        status = 'done', progress = 1,
        lat_now = ${HOME_LAT}, lng_now = ${HOME_LNG},
        battery = ${battery}, completed_at = now(), phase_started_at = now()
      WHERE id = ${mission.id}
    `;
    publishPosition({
      droneId: mission.drone_id,
      missionId: mission.id,
      lat: HOME_LAT,
      lng: HOME_LNG,
      battery,
      status: "done",
      progress: 1,
      ts: Math.floor(nowMs / 1000),
    });
    await patchDrone(mission.drone_id, { status: "idle" });
    await completeRequestIfDone(mission.request_id);
    log(
      "info",
      `mission ${mission.id} done (drone ${mission.drone_name}, battery ${battery}%)`,
    );
    return true;
  }

  await sql`
    UPDATE missions SET
      status = ${view.status}, progress = ${view.progress},
      lat_now = ${view.lat}, lng_now = ${view.lng},
      battery = ${view.battery},
      phase_started_at = ${new Date(view.phaseStartMs)}
    WHERE id = ${mission.id}
  `;

  publishPosition({
    droneId: mission.drone_id,
    missionId: mission.id,
    lat: view.lat,
    lng: view.lng,
    battery: view.battery,
    status: view.status,
    progress: view.progress,
    ts: Math.floor(nowMs / 1000),
  });

  if (view.status === mission.status) return false;

  // Phase change: tell drone-management where the drone is and what it does.
  log(
    "info",
    `mission ${mission.id} ${mission.status} -> ${view.status} (drone ${mission.drone_name})`,
  );
  await patchDrone(mission.drone_id, {
    status: view.status,
    lat: view.lat,
    lng: view.lng,
    battery: view.battery,
    agent: mission.agent,
  });
  return true;
}

async function tick(): Promise<void> {
  if (!isLeader || tickBusy) return;
  tickBusy = true;
  try {
    const missions = await sql<MissionRow[]>`
      SELECT * FROM missions
      WHERE status IN ('assigned', 'enroute', 'spraying', 'returning')
      ORDER BY started_at ASC
    `;
    let changed = false;
    for (const mission of missions) {
      try {
        if (await advance(mission)) changed = true;
      } catch (error) {
        log("error", `mission ${mission.id} tick failed: ${errMessage(error)}`);
      }
    }
    if (changed) await broadcastState();
  } catch (error) {
    log("warn", `simulator tick failed: ${errMessage(error)} (re-electing leader)`);
    isLeader = false;
    await dropLeaderConnection();
  } finally {
    tickBusy = false;
  }
}

async function dropLeaderConnection(): Promise<void> {
  const conn = leaderConn;
  leaderConn = null;
  if (!conn) return;
  try {
    await conn.release();
  } catch {
    /* ignore */
  }
}

async function acquireLeadership(): Promise<boolean> {
  try {
    if (!leaderConn) leaderConn = await lockSql.reserve();
    const rows = await leaderConn<{ ok: boolean }[]>`
      SELECT pg_try_advisory_lock(${SIMULATOR_LOCK_KEY}) AS ok
    `;
    const acquired = rows[0]?.ok === true;
    if (acquired) {
      if (!isLeader) {
        log("info", `simulator leader (advisory lock ${SIMULATOR_LOCK_KEY} acquired)`);
      }
      isLeader = true;
    } else {
      isLeader = false;
      if (!notLeaderLogged) {
        log(
          "info",
          `simulator follower (advisory lock ${SIMULATOR_LOCK_KEY} held elsewhere); ticks disabled`,
        );
        notLeaderLogged = true;
      }
    }
    return acquired;
  } catch (error) {
    log("warn", `simulator leadership check failed: ${errMessage(error)}`);
    isLeader = false;
    await dropLeaderConnection();
    return false;
  }
}

export function startSimulator(): void {
  void acquireLeadership();
  // Re-elect when the current leader disappears.
  setInterval(() => {
    if (!isLeader) void acquireLeadership();
  }, ELECTION_RETRY_MS);
  setInterval(() => {
    void tick();
  }, TICK_MS);
  log("info", "simulator scheduled (1 s ticks, leader-only)");
}

export async function stopSimulator(): Promise<void> {
  isLeader = false;
  await dropLeaderConnection();
  try {
    await lockSql.end({ timeout: 1 });
  } catch {
    /* ignore */
  }
}
