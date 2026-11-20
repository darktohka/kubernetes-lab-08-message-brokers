// Redis: one publisher for `drone.positions`, one subscriber that fans those
// messages out to SSE clients (the pub/sub fan-out demo).
//
// The simulator publishes; this replica receives its own message back through
// Redis and that is exactly what the SSE `positions` event is built from.
import Redis from "ioredis";
import { REDIS_URL, errMessage, log, sleep } from "./config.ts";
import { decode, encode } from "./codec.ts";
import { broadcast } from "./sse.ts";

export const CHANNEL_POSITIONS = "drone.positions";

export interface PositionMessage {
  droneId: string;
  missionId: string | null;
  lat: number;
  lng: number;
  battery: number;
  status: string;
  progress: number;
  ts: number;
}

const redisOptions = {
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
  maxRetriesPerRequest: null as null,
  enableOfflineQueue: true,
  lazyConnect: true,
};

export const redisPub = new Redis(REDIS_URL, redisOptions);
redisPub.on("error", (error) => log("warn", `redis publisher error: ${errMessage(error)}`));
redisPub.on("ready", () => log("info", "redis publisher ready"));

/** Retries forever; Redis being down must not affect HTTP. */
export async function connectRedis(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await redisPub.connect();
      return;
    } catch (error) {
      log(
        "warn",
        `redis connect attempt ${attempt} failed: ${errMessage(error)} (retrying)`,
      );
      await sleep(Math.min(1000 * attempt, 10_000));
    }
  }
}

export function publishPosition(position: PositionMessage): void {
  redisPub.publish(CHANNEL_POSITIONS, encode(position)).catch((error: unknown) => {
    log("warn", `redis publish ${CHANNEL_POSITIONS} failed: ${errMessage(error)}`);
  });
}

// --- subscriber -> SSE -------------------------------------------------------

const latest = new Map<string, PositionMessage>();
let latestDirty = false;

function toChannelName(channel: string | Buffer): string {
  return typeof channel === "string" ? channel : channel.toString("utf8");
}

function handleMessage(channel: string | Buffer, raw: string | Buffer): void {
  if (toChannelName(channel) !== CHANNEL_POSITIONS) return;
  try {
    const parsed: unknown = decode(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    const value = parsed as Record<string, unknown>;
    if (typeof value.droneId !== "string") return;
    if (typeof value.lat !== "number" || typeof value.lng !== "number") return;
    const position: PositionMessage = {
      droneId: value.droneId,
      missionId: typeof value.missionId === "string" ? value.missionId : null,
      lat: value.lat,
      lng: value.lng,
      battery: typeof value.battery === "number" ? value.battery : 0,
      status: typeof value.status === "string" ? value.status : "unknown",
      progress: typeof value.progress === "number" ? value.progress : 0,
      ts: typeof value.ts === "number" ? value.ts : Math.floor(Date.now() / 1000),
    };
    latest.set(position.droneId, position);
    latestDirty = true;
  } catch {
    // Ignore malformed payloads published by anyone else on the channel.
  }
}

/**
 * Coalesces all position messages seen during one second into a single
 * `event: positions` frame, i.e. at most 1 SSE positions frame per second.
 */
function flushPositions(): void {
  if (!latestDirty) return;
  latestDirty = false;
  broadcast("positions", { positions: [...latest.values()] });
}

let subscriber: Redis | null = null;

export function startPositionSubscriber(): void {
  if (subscriber) return;
  const client = new Redis(REDIS_URL, {
    ...redisOptions,
    lazyConnect: false,
  });
  subscriber = client;

  client.on("error", (error) =>
    log("warn", `redis subscriber error: ${errMessage(error)}`),
  );
  client.on("ready", () => {
    log("info", `redis subscriber ready; subscribing to ${CHANNEL_POSITIONS}`);
    // Re-run on every (re)connect.
    client.subscribe(CHANNEL_POSITIONS).catch((error: unknown) => {
      log("warn", `redis subscribe failed: ${errMessage(error)}`);
    });
  });
  // `messageBuffer` (not `message`): ioredis' string event UTF-8-decodes the
  // payload, which would corrupt MessagePack frames.
  client.on("messageBuffer", handleMessage);

  setInterval(flushPositions, 1000);
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redisPub.quit();
  } catch {
    /* ignore */
  }
  try {
    await subscriber?.quit();
  } catch {
    /* ignore */
  }
}
