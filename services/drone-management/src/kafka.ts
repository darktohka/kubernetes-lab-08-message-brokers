import { Kafka, Partitioners, logLevel } from "kafkajs";
import { decode, encode } from "./codec.ts";
import { UUID_RE, sql, toDrone } from "./db.ts";

const BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);

export const kafka = new Kafka({
  clientId: "drone-management",
  brokers: BROKERS,
  retry: { retries: 20, initialRetryTime: 500 },
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });

let producerReady = false;
let producerReconnecting = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectProducer(): Promise<void> {
  let delay = 1000;
  for (;;) {
    try {
      await producer.connect();
      producerReady = true;
      console.log("[kafka] producer connected");
      return;
    } catch (err) {
      producerReady = false;
      console.warn("[kafka] producer connect failed:", (err as Error).message);
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}

/** Publish `drone.status` on drone.events. Never throws. */
export async function publishDroneEvent(droneId: string, status: string): Promise<void> {
  if (!producerReady) {
    console.warn(`[kafka] producer not connected; dropping drone event ${droneId}:${status}`);
    return;
  }
  try {
    await producer.send({
      topic: "drone.events",
      messages: [
        {
          key: droneId,
          value: encode({
            type: "drone.status",
            droneId,
            status,
            at: new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (err) {
    console.warn("[kafka] drone event publish failed:", (err as Error).message);
  }
}

const seenCommands = new Set<string>();

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

async function handleCommand(raw: Uint8Array | string): Promise<void> {
  const cmd = decode<Record<string, any>>(raw);
  if (!cmd || cmd.type !== "assign") return;

  const droneId = String(cmd.droneId ?? "");
  if (!UUID_RE.test(droneId)) {
    console.warn("[kafka] assign command with invalid droneId, skipped");
    return;
  }

  const commandId =
    typeof cmd.commandId === "string" && cmd.commandId.length > 0
      ? cmd.commandId
      : `${droneId}:${cmd.missionId ?? ""}:${cmd.at ?? ""}`;

  if (seenCommands.has(commandId)) return;
  const already = await sql`SELECT 1 FROM applied_commands WHERE command_id = ${commandId}`;
  if (already.length > 0) {
    seenCommands.add(commandId);
    return;
  }

  const patch: Record<string, any> = {
    status: "assigned",
    assigned_location_id: uuidOrNull(cmd.locationId),
    assigned_location_name: typeof cmd.locationName === "string" ? cmd.locationName : null,
    agent: typeof cmd.agent === "string" ? cmd.agent : null,
  };
  if (typeof cmd.lat === "number" && Number.isFinite(cmd.lat)) patch.lat = cmd.lat;
  if (typeof cmd.lng === "number" && Number.isFinite(cmd.lng)) patch.lng = cmd.lng;

  const rows = await sql`
    UPDATE drones SET ${sql(patch)}, updated_at = now()
    WHERE id = ${droneId} RETURNING *`;
  if (rows.length === 0) {
    console.warn(`[kafka] assign for unknown drone ${droneId}, ignored`);
    return;
  }

  await sql`INSERT INTO applied_commands (command_id) VALUES (${commandId}) ON CONFLICT (command_id) DO NOTHING`;
  seenCommands.add(commandId);

  const drone = toDrone(rows[0]);
  console.log(`[kafka] applied assign ${commandId} -> ${drone.name}`);
  await publishDroneEvent(drone.id, drone.status);
}

async function startCommandsConsumer(): Promise<void> {
  let delay = 1000;
  for (;;) {
    const consumer = kafka.consumer({
      groupId: "drone-management-commands",
      retry: { retries: 20, initialRetryTime: 500 },
    });
    try {
      await consumer.connect();
      await consumer.subscribe({ topic: "drone.commands", fromBeginning: false });
      await consumer.run({
        eachMessage: async ({ message }) => {
          try {
            if (message.value) await handleCommand(message.value);
          } catch (err) {
            console.warn("[kafka] command handling failed:", (err as Error).message);
          }
        },
      });
      console.log("[kafka] commands consumer running (group drone-management-commands)");
      return;
    } catch (err) {
      console.warn("[kafka] consumer start failed:", (err as Error).message);
      try {
        await consumer.disconnect();
      } catch {
        /* ignore */
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}

/** Start producer + command consumer in the background; failures never block HTTP. */
export function startKafka(): void {
  producer.on("producer.disconnect", () => {
    producerReady = false;
    if (!producerReconnecting) {
      producerReconnecting = true;
      console.warn("[kafka] producer disconnected, reconnecting");
      connectProducer().finally(() => {
        producerReconnecting = false;
      });
    }
  });

  void connectProducer();
  void startCommandsConsumer();
}
