import Redis from "ioredis";
import { decode } from "./codec.ts";
import { isDroneStatus, sql, toDrone } from "./db.ts";
import { publishDroneEvent } from "./kafka.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CHANNEL = "drone.positions";
const WRITE_INTERVAL_MS = 1000;

type Pending = {
  lat: number;
  lng: number;
  battery: number | null;
  status: string;
};

/** Latest unflushed position per drone. */
const pending = new Map<string, Pending>();
/** Last DB write time per drone (ms) — kept outside `pending` so the throttle survives flushes. */
const lastWriteAt = new Map<string, number>();

function handlePosition(raw: Buffer | string): void {
  let msg: Record<string, any>;
  try {
    msg = decode<Record<string, any>>(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object" || typeof msg.droneId !== "string" || msg.droneId.length === 0)
    return;

  const droneId = msg.droneId;
  const prev = pending.get(droneId);

  const lat = typeof msg.lat === "number" && Number.isFinite(msg.lat) ? msg.lat : prev?.lat;
  const lng = typeof msg.lng === "number" && Number.isFinite(msg.lng) ? msg.lng : prev?.lng;
  const battery =
    typeof msg.battery === "number" && Number.isFinite(msg.battery)
      ? Math.min(100, Math.max(0, Math.round(msg.battery)))
      : (prev?.battery ?? null);
  const status = isDroneStatus(msg.status) ? msg.status : prev?.status;

  if (lat === undefined || lng === undefined || status === undefined) return;

  // Only the newest value is kept; if a write already happened <1s ago it is flushed later.
  pending.set(droneId, { lat, lng, battery, status });
}

async function flushDrone(droneId: string, value: Pending): Promise<void> {
  const patch: Record<string, any> = { lat: value.lat, lng: value.lng, status: value.status };
  if (value.battery !== null) patch.battery = value.battery;

  const [existing] = await sql<{ status: string }[]>`SELECT status FROM drones WHERE id = ${droneId}`;
  if (!existing) {
    lastWriteAt.delete(droneId);
    return;
  }

  const rows = await sql`
    UPDATE drones SET ${sql(patch)}, updated_at = now()
    WHERE id = ${droneId} RETURNING *`;
  if (rows.length === 0) return;

  if (existing.status !== value.status) {
    const drone = toDrone(rows[0]);
    console.log(`[redis] ${drone.name} status ${existing.status} -> ${value.status}`);
    await publishDroneEvent(drone.id, drone.status);
  }
}

let flushing = false;

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    for (const [droneId, value] of pending) {
      if (now - (lastWriteAt.get(droneId) ?? 0) < WRITE_INTERVAL_MS) continue;
      pending.delete(droneId);
      lastWriteAt.set(droneId, now);
      try {
        await flushDrone(droneId, value);
      } catch (err) {
        console.warn("[redis] position write failed:", (err as Error).message);
      }
    }
  } finally {
    flushing = false;
  }
}

/** Subscribe to drone.positions; connection retries in the background. */
export function startRedis(): void {
  const sub = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 1000, 15000),
    maxRetriesPerRequest: null,
  });

  let lastErrorLog = 0;
  sub.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLog > 5000) {
      lastErrorLog = now;
      console.warn("[redis] connection error:", err.message);
    }
  });
  sub.on("ready", () => console.log("[redis] subscriber connected"));
  // Positions arrive as MessagePack binaries; `messageBuffer` keeps the raw bytes
  // (the plain `message` event would decode them lossily as utf8).
  sub.on("messageBuffer", (channel: Buffer, message: Buffer) => {
    if (channel.toString() === CHANNEL) handlePosition(message);
  });

  sub.subscribe(CHANNEL).catch((err: Error) => {
    console.warn("[redis] subscribe failed:", err.message);
  });

  setInterval(() => void flush(), 250);
}
