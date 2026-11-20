import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { decode, encode } from "./codec.ts";
import {
  BASE_LAT,
  BASE_LNG,
  STATUSES,
  UUID_RE,
  initDb,
  isDroneStatus,
  parkingSpot,
  randomPosition,
  sql,
  toDrone,
  type DroneStatus,
} from "./db.ts";
import { publishDroneEvent, startKafka } from "./kafka.ts";
import { startRecharge } from "./recharge.ts";
import { startRedis } from "./redis.ts";

const PORT = Number(process.env.PORT ?? 3001);
const SERVICE_INSTANCE =
  process.env.SERVICE_INSTANCE ?? `${process.env.HOSTNAME ?? "drone-management"}:${process.pid}`;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
  }),
);

app.get("/healthz", (c) => c.json({ status: "ok" }));

async function readJson(c: Context): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** True when the Accept header asks for MessagePack (JSON stays the default). */
function prefersMsgpack(c: Context): boolean {
  const accept = c.req.header("accept");
  return accept !== undefined && accept.toLowerCase().includes("application/msgpack");
}

/** Send `payload` as MessagePack for msgpack clients, JSON otherwise (same shape either way). */
function respondPayload(c: Context, payload: unknown): Response {
  if (prefersMsgpack(c)) {
    return c.body(new Uint8Array(encode(payload)), 200, {
      "Content-Type": "application/msgpack",
    });
  }
  return c.json(payload);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PatchResult = { error: string } | { values: Record<string, any> };

/** Validate a PATCH body; returns validated snake_case column values. */
function validatePatch(body: Record<string, any>): PatchResult {
  const values: Record<string, any> = {};

  if ("status" in body) {
    if (!isDroneStatus(body.status)) {
      return { error: `status must be one of ${STATUSES.join(", ")}` };
    }
    values.status = body.status;
  }

  if ("lat" in body) {
    if (typeof body.lat !== "number" || !Number.isFinite(body.lat) || body.lat < -90 || body.lat > 90) {
      return { error: "lat must be a number between -90 and 90" };
    }
    values.lat = body.lat;
  }

  if ("lng" in body) {
    if (
      typeof body.lng !== "number" ||
      !Number.isFinite(body.lng) ||
      body.lng < -180 ||
      body.lng > 180
    ) {
      return { error: "lng must be a number between -180 and 180" };
    }
    values.lng = body.lng;
  }

  if ("battery" in body) {
    if (
      typeof body.battery !== "number" ||
      !Number.isFinite(body.battery) ||
      body.battery < 0 ||
      body.battery > 100
    ) {
      return { error: "battery must be a number between 0 and 100" };
    }
    values.battery = Math.round(body.battery);
  }

  if ("agent" in body) {
    if (body.agent !== null && typeof body.agent !== "string") {
      return { error: "agent must be a string or null" };
    }
    values.agent = body.agent;
  }

  if ("assignedLocationId" in body) {
    if (body.assignedLocationId !== null && !UUID_RE.test(String(body.assignedLocationId))) {
      return { error: "assignedLocationId must be a uuid or null" };
    }
    values.assigned_location_id = body.assignedLocationId;
  }

  if ("assignedLocationName" in body) {
    if (body.assignedLocationName !== null && typeof body.assignedLocationName !== "string") {
      return { error: "assignedLocationName must be a string or null" };
    }
    values.assigned_location_name = body.assignedLocationName;
  }

  return { values };
}

app.get("/api/drones", async (c) => {
  const status = c.req.query("status");
  try {
    const rows = status
      ? await sql`SELECT * FROM drones WHERE status = ${status} ORDER BY name`
      : await sql`SELECT * FROM drones ORDER BY name`;
    return respondPayload(c, { drones: rows.map(toDrone) });
  } catch (err) {
    console.error("[api] list drones failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/api/drones/stats", async (c) => {
  try {
    const [row] = await sql<{ total: string; idle: string }[]>`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE status = 'idle')::text AS idle
      FROM drones`;
    const total = Number(row?.total ?? 0);
    const idle = Number(row?.idle ?? 0);
    return respondPayload(c, { total, idle, busy: total - idle });
  } catch (err) {
    console.error("[api] stats failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/api/drones/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
  try {
    const rows = await sql`SELECT * FROM drones WHERE id = ${id}`;
    if (rows.length === 0) return c.json({ error: "not found" }, 404);
    return respondPayload(c, toDrone(rows[0]));
  } catch (err) {
    console.error("[api] get drone failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.post("/api/drones", async (c) => {
  const raw = await readJson(c);
  if (raw !== undefined && !isPlainObject(raw)) {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const body: Record<string, any> = raw ?? {};

  let name: string;
  if (body.name === undefined) {
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM drones`;
    name = `Falcon-${String(Number(count) + 1).padStart(2, "0")}`;
  } else if (typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "name must be a non-empty string" }, 400);
  } else {
    name = body.name.trim();
  }

  let model = "DJI Agras T40";
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || body.model.trim() === "") {
      return c.json({ error: "model must be a non-empty string" }, 400);
    }
    model = body.model.trim();
  }

  // Use the given position only when both coordinates are valid; otherwise pick a random one.
  let lat: number;
  let lng: number;
  if (body.lat !== undefined && body.lng !== undefined) {
    if (
      typeof body.lat !== "number" ||
      !Number.isFinite(body.lat) ||
      body.lat < -90 ||
      body.lat > 90
    ) {
      return c.json({ error: "lat must be a number between -90 and 90" }, 400);
    }
    if (
      typeof body.lng !== "number" ||
      !Number.isFinite(body.lng) ||
      body.lng < -180 ||
      body.lng > 180
    ) {
      return c.json({ error: "lng must be a number between -180 and 180" }, 400);
    }
    lat = body.lat;
    lng = body.lng;
  } else {
    const position = randomPosition();
    lat = position.lat;
    lng = position.lng;
  }

  try {
    const rows = await sql`
      INSERT INTO drones (name, model, status, lat, lng, home_lat, home_lng, battery)
      VALUES (${name}, ${model}, 'idle', ${lat}, ${lng}, ${BASE_LAT}, ${BASE_LNG}, 100)
      RETURNING *`;
    return c.json(toDrone(rows[0]), 201);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return c.json({ error: `name '${name}' already exists` }, 409);
    }
    console.error("[api] create drone failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.patch("/api/drones/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  let raw: any;
  if (contentType.includes("application/msgpack")) {
    try {
      raw = decode(new Uint8Array(await c.req.arrayBuffer()));
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
  } else {
    raw = await readJson(c);
  }
  if (!isPlainObject(raw)) return c.json({ error: "invalid JSON body" }, 400);

  const validated = validatePatch(raw);
  if ("error" in validated) return c.json({ error: validated.error }, 400);
  const patch = validated.values;

  try {
    const existingRows = await sql`SELECT * FROM drones WHERE id = ${id}`;
    if (existingRows.length === 0) return c.json({ error: "not found" }, 404);
    const existing = existingRows[0];
    const previousStatus = existing.status as DroneStatus;

    // Going idle with no explicit position parks the drone on its own pad slot
    // (deterministic per id) instead of stacking every drone on the base marker.
    if (patch.status === "idle") {
      if (!("lat" in patch) && !("lng" in patch)) {
        const spot = parkingSpot(id);
        patch.lat = spot.lat;
        patch.lng = spot.lng;
      } else {
        if (!("lat" in patch)) patch.lat = existing.home_lat;
        if (!("lng" in patch)) patch.lng = existing.home_lng;
      }
      if (!("assigned_location_id" in patch)) patch.assigned_location_id = null;
      if (!("assigned_location_name" in patch)) patch.assigned_location_name = null;
      // Empty tank back at base: drop the stale mission agent unless set explicitly.
      if (!("agent" in patch)) patch.agent = null;
    }

    if (Object.keys(patch).length === 0) {
      return c.json(toDrone(existing));
    }

    const rows = await sql`
      UPDATE drones SET ${sql(patch)}, updated_at = now()
      WHERE id = ${id} RETURNING *`;
    if (rows.length === 0) return c.json({ error: "not found" }, 404);

    const drone = toDrone(rows[0]);
    if (patch.status !== undefined && patch.status !== previousStatus) {
      await publishDroneEvent(drone.id, drone.status);
    }
    return c.json(drone);
  } catch (err) {
    console.error("[api] patch drone failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.post("/api/drones/:id/reset", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

  try {
    const spot = parkingSpot(id);
    const rows = await sql`
      UPDATE drones SET
        status = 'idle',
        lat = ${spot.lat},
        lng = ${spot.lng},
        battery = 100,
        agent = NULL,
        assigned_location_id = NULL,
        assigned_location_name = NULL,
        updated_at = now()
      WHERE id = ${id} RETURNING *`;
    if (rows.length === 0) return c.json({ error: "not found" }, 404);
    const drone = toDrone(rows[0]);
    await publishDroneEvent(drone.id, drone.status);
    return c.json(drone);
  } catch (err) {
    console.error("[api] reset drone failed:", (err as Error).message);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  console.error("[api] unhandled error:", err.message);
  return c.json({ error: "internal server error" }, 500);
});

Bun.serve({ port: PORT, fetch: app.fetch, idleTimeout: 0 });
console.log(`[http] drone-management ${SERVICE_INSTANCE} listening on :${PORT}`);

let stopRecharge: (() => void) | undefined;

void initDb().then(() => {
  startKafka();
  startRedis();
  stopRecharge = startRecharge();
});

const shutdown = () => {
  console.log("[http] shutting down");
  stopRecharge?.();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
