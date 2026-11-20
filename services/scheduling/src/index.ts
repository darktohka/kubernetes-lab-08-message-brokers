// HTTP API + process wiring for the scheduling service.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { PORT, UUID_RE, errMessage, log } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { fetchLocation, patchDrone } from "./clients.ts";
import {
  TOPIC_REQUESTS,
  connectProducer,
  disconnectKafka,
  publishWithRetry,
  startConsumers,
} from "./kafka.ts";
import { connectRedis, disconnectRedis, startPositionSubscriber } from "./redis.ts";
import { addClient, broadcastState, removeClient, startStateHeartbeat } from "./sse.ts";
import { tryAssign } from "./assign.ts";
import { startSimulator, stopSimulator } from "./simulator.ts";
import { getState, listMissions, listRequests, toWireMission, toWireRequest } from "./wire.ts";
import type { MissionRow, RequestRow } from "./wire.ts";

const DEFAULT_FLIGHT_MS = 30 * 60 * 1000;
const MAX_DRONES_PER_REQUEST = 50;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    exposeHeaders: ["*"],
    maxAge: 86400,
  }),
);

app.onError((error, c) => {
  log("error", `unhandled request error: ${errMessage(error)}`);
  return c.json({ error: "internal server error" }, 500);
});

// Health is dependency-free on purpose: it must answer even during an outage.
app.get("/healthz", (c) => c.json({ status: "ok" }));

const api = new Hono();

api.get("/requests", async (c) => {
  const rows = await listRequests();
  return c.json({ requests: rows.map(toWireRequest) });
});

api.post("/requests", async (c) => {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await c.req.json();
    body = isRecord(raw) ? raw : {};
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
  if (!UUID_RE.test(locationId)) {
    return c.json({ error: "locationId is required and must be a uuid" }, 400);
  }

  let droneCount = 1;
  if (body.droneCount !== undefined && body.droneCount !== null) {
    const parsed = Number(body.droneCount);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_DRONES_PER_REQUEST
    ) {
      return c.json(
        { error: `droneCount must be an integer between 1 and ${MAX_DRONES_PER_REQUEST}` },
        400,
      );
    }
    droneCount = parsed;
  }

  const startsAt = parseDate(body.startsAt) ?? new Date();
  if (body.startsAt !== undefined && body.startsAt !== null && parseDate(body.startsAt) === null) {
    return c.json({ error: "startsAt must be a valid ISO timestamp" }, 400);
  }
  const parsedEndsAt = parseDate(body.endsAt);
  if (body.endsAt !== undefined && body.endsAt !== null && parsedEndsAt === null) {
    return c.json({ error: "endsAt must be a valid ISO timestamp" }, 400);
  }
  const endsAt = parsedEndsAt ?? new Date(startsAt.getTime() + DEFAULT_FLIGHT_MS);
  if (endsAt.getTime() <= startsAt.getTime()) {
    return c.json({ error: "endsAt must be after startsAt" }, 400);
  }

  // The location service is the owner of plot data; 400 when it 404s or is down.
  const location = await fetchLocation(locationId);
  if (!location.ok) {
    return c.json({ error: location.error }, 400);
  }

  const requestedAgent =
    typeof body.agent === "string" && body.agent.trim() ? body.agent.trim() : null;
  const agent = requestedAgent ?? location.location.agent;

  const requestId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  let row: RequestRow | undefined;
  try {
    const inserted = await sql<RequestRow[]>`
      INSERT INTO schedule_requests (
        id, source_message_id, location_id, location_name, lat, lng,
        drone_count, agent, starts_at, ends_at, status
      ) VALUES (
        ${requestId}, ${messageId}, ${location.location.id}, ${location.location.name},
        ${location.location.lat}, ${location.location.lng}, ${droneCount}, ${agent},
        ${startsAt}, ${endsAt}, 'queued'
      )
      RETURNING *
    `;
    row = inserted[0];
  } catch (error) {
    log("error", `insert schedule_request failed: ${errMessage(error)}`);
    return c.json({ error: "database unavailable" }, 503);
  }

  if (!row) return c.json({ error: "could not create request" }, 500);

  // Exactly the contract payload. The DB row is the source of truth: if Kafka
  // is down we still answer 202 and the 5 s reconciler will assign locally.
  const payload = {
    messageId: row.source_message_id,
    requestId: row.id,
    locationId: row.location_id,
    droneCount: row.drone_count,
    agent: row.agent,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    at: new Date().toISOString(),
  };
  const published = await publishWithRetry(TOPIC_REQUESTS, row.id, payload, 3);
  if (!published) {
    log(
      "error",
      `request ${row.id} queued locally but not published to ${TOPIC_REQUESTS}; will be assigned by the reconciler`,
    );
  }

  void broadcastState();
  return c.json({ request: toWireRequest(row) }, 202);
});

api.delete("/requests/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "request not found" }, 404);

  const updated = await sql<RequestRow[]>`
    UPDATE schedule_requests SET status = 'cancelled'
    WHERE id = ${id}
    RETURNING *
  `;
  const row =
    updated[0] ??
    (
      await sql<RequestRow[]>`
        SELECT * FROM schedule_requests WHERE id = ${id} LIMIT 1
      `
    )[0];
  if (!row) return c.json({ error: "request not found" }, 404);

  // Stop every mission that is still in flight and release its drone.
  const cancelled = await sql<{ drone_id: string }[]>`
    UPDATE missions
    SET status = 'cancelled', completed_at = COALESCE(completed_at, now())
    WHERE request_id = ${id} AND status IN ('assigned', 'enroute', 'spraying', 'returning')
    RETURNING drone_id
  `;
  for (const mission of cancelled) {
    void patchDrone(mission.drone_id, { status: "idle" });
  }

  void broadcastState();
  return c.json({ request: toWireRequest(row) });
});

api.get("/missions", async (c) => {
  const rows = await listMissions();
  return c.json({ missions: rows.map(toWireMission) });
});

api.get("/state", async (c) => c.json(await getState()));

// Server-sent events: full state on connect, then position frames (fed by Redis)
// and state frames (on change + every 5 s so follower replicas stay useful).
api.get("/stream", (c) =>
  streamSSE(c, async (stream) => {
    addClient(stream);
    stream.onAbort(() => removeClient(stream));
    try {
      const state = await getState();
      await stream.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);

      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
        await stream.write(": ping\n\n");
      }
    } catch {
      // Client disconnected mid-write; the finally block cleans up.
    } finally {
      removeClient(stream);
    }
  }),
);

app.route("/api/scheduling", api);

// --- Kafka consumers ---------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

async function handleScheduleRequestMessage(payload: unknown): Promise<void> {
  if (!isRecord(payload)) {
    log("warn", "ignoring non-object message on schedule.requests");
    return;
  }

  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const locationId = typeof payload.locationId === "string" ? payload.locationId : "";
  if (!messageId || !UUID_RE.test(locationId)) {
    log("warn", `ignoring schedule.requests message with bad messageId/locationId`);
    return;
  }

  const rawCount = Number(payload.droneCount);
  const droneCount = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 1;
  const startsAt = parseDate(payload.startsAt) ?? new Date();
  const endsAt = parseDate(payload.endsAt) ?? new Date(startsAt.getTime() + DEFAULT_FLIGHT_MS);
  const agent =
    typeof payload.agent === "string" && payload.agent.trim() ? payload.agent.trim() : null;
  const requestId =
    typeof payload.requestId === "string" && UUID_RE.test(payload.requestId)
      ? payload.requestId
      : crypto.randomUUID();

  const location = await fetchLocation(locationId);
  if (!location.ok) {
    // Normal case: the API already inserted the row before publishing.
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM schedule_requests WHERE source_message_id = ${messageId} LIMIT 1
    `;
    if (existing.length === 0) {
      log("warn", `cannot materialise request from message ${messageId}: ${location.error}`);
    }
    return;
  }

  // Idempotency: the messageId is unique, so replays/redeliveries are no-ops.
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO schedule_requests (
      id, source_message_id, location_id, location_name, lat, lng,
      drone_count, agent, starts_at, ends_at, status
    ) VALUES (
      ${requestId}, ${messageId}, ${location.location.id}, ${location.location.name},
      ${location.location.lat}, ${location.location.lng}, ${droneCount}, ${agent},
      ${startsAt}, ${endsAt}, 'queued'
    )
    ON CONFLICT (source_message_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length === 0) return; // already materialised -> nothing to do

  log("info", `request ${inserted[0].id} materialised from kafka message ${messageId}`);
  await broadcastState();
  await tryAssign("kafka-request");
}

async function handleDroneEventMessage(payload: unknown): Promise<void> {
  if (!isRecord(payload)) return;
  if (payload.status !== "idle") return;
  log("info", `drone ${String(payload.droneId ?? "?")} is idle; re-running assignment`);
  await tryAssign("drone-idle");
}

// --- bootstrap ---------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const migrated = await migrate();

  // None of these reject: they retry in the background forever.
  void connectProducer();
  void connectRedis();

  startPositionSubscriber();
  startConsumers({
    onScheduleRequest: handleScheduleRequestMessage,
    onDroneEvent: handleDroneEventMessage,
  });

  // 5 s reconciler: also the safety net when a Kafka publish failed.
  setInterval(() => {
    void tryAssign("timer");
  }, 5000);
  void tryAssign("startup");

  startSimulator();
  // Independent of leadership: every replica pushes state to its SSE clients.
  startStateHeartbeat(5000);

  log("info", `bootstrap complete (migrations=${migrated ? "ok" : "failed"})`);
}

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 0,
});

log("info", `scheduling API listening on :${PORT}`);
void bootstrap().catch((error: unknown) => {
  log("error", `bootstrap failed: ${errMessage(error)}`);
});

process.on("unhandledRejection", (reason) => {
  log("error", `unhandled rejection: ${errMessage(reason)}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", `${signal} received, shutting down`);
  try {
    server.stop(true);
  } catch {
    /* ignore */
  }
  await stopSimulator();
  await disconnectKafka();
  await disconnectRedis();
  try {
    await sql.end({ timeout: 2 });
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
