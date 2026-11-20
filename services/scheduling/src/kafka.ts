// Kafka producer, topic bootstrap and the two consumer groups.
//
// Connections are retried forever with capped backoff: Kafka being down must
// never take the HTTP API down with it.
import { Kafka, logLevel } from "kafkajs";
import type { Consumer, Producer } from "kafkajs";
import { KAFKA_BROKERS, KAFKA_CLIENT_ID, errMessage, log, sleep } from "./config.ts";
import { decode, encode } from "./codec.ts";

export const TOPIC_REQUESTS = "schedule.requests";
export const TOPIC_DRONE_EVENTS = "drone.events";
export const TOPIC_DRONE_COMMANDS = "drone.commands";

export const GROUP_REQUESTS = "scheduling-requests";
export const GROUP_DRONE_EVENTS = "scheduling-drone-events";

const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: KAFKA_BROKERS,
  retry: { retries: 20, initialRetryTime: 500 },
  logLevel: logLevel.WARN,
});

const producer: Producer = kafka.producer({ allowAutoTopicCreation: true });

let producerConnected = false;

export function isKafkaConnected(): boolean {
  return producerConnected;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * attempt, 10_000);
}

async function ensureTopics(): Promise<void> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existing = new Set(await admin.listTopics());
    const wanted = [
      { topic: TOPIC_REQUESTS, numPartitions: 3, replicationFactor: 1 },
      { topic: TOPIC_DRONE_EVENTS, numPartitions: 3, replicationFactor: 1 },
      { topic: TOPIC_DRONE_COMMANDS, numPartitions: 3, replicationFactor: 1 },
    ].filter((topic) => !existing.has(topic.topic));
    if (wanted.length === 0) return;
    await admin.createTopics({ waitForLeaders: false, topics: wanted });
    log("info", `kafka topics created: ${wanted.map((t) => t.topic).join(", ")}`);
  } catch (error) {
    // Never fatal: the brokers may auto-create topics on first publish.
    log("warn", `kafka createTopics: ${errMessage(error)}`);
  } finally {
    try {
      await admin.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function connectProducer(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await producer.connect();
      producerConnected = true;
      log("info", `kafka producer connected (${KAFKA_BROKERS.join(",")})`);
      await ensureTopics();
      return;
    } catch (error) {
      producerConnected = false;
      log(
        "warn",
        `kafka producer connect attempt ${attempt} failed: ${errMessage(error)} (retrying)`,
      );
      await sleep(backoffMs(attempt));
    }
  }
}

producer.on(producer.events.DISCONNECT, () => {
  producerConnected = false;
  log("warn", "kafka producer disconnected");
});

export async function publish(
  topic: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  try {
    await producer.send({
      topic,
      // Message *keys* stay plain strings (routing); only the value is msgpack.
      messages: [{ key, value: encode(value) }],
    });
    return true;
  } catch (error) {
    log("error", `kafka publish to ${topic} failed: ${errMessage(error)}`);
    return false;
  }
}

export async function publishWithRetry(
  topic: string,
  key: string,
  value: unknown,
  attempts = 3,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await publish(topic, key, value)) return true;
    if (attempt < attempts) await sleep(250 * 2 ** (attempt - 1));
  }
  log("error", `kafka publish to ${topic} failed after ${attempts} attempts`);
  return false;
}

export interface ConsumerHandlers {
  onScheduleRequest: (payload: unknown) => Promise<void>;
  onDroneEvent: (payload: unknown) => Promise<void>;
}

async function runConsumer(
  groupId: string,
  topic: string,
  label: string,
  handler: (payload: unknown) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const consumer: Consumer = kafka.consumer({ groupId });
    try {
      consumer.on(consumer.events.CRASH, (event) => {
        log("error", `kafka consumer ${label} crashed: ${errMessage(event.payload.error)}`);
      });
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }) => {
          // Per-message isolation: one bad payload must not stop the consumer.
          try {
            if (!message.value) return;
            // MessagePack, with tolerance for legacy JSON text (see codec.ts).
            const payload: unknown = decode(message.value);
            await handler(payload);
          } catch (error) {
            log(
              "error",
              `kafka ${label} message failed (offset ${message.offset}): ${errMessage(error)}`,
            );
          }
        },
      });
      log("info", `kafka consumer ${label} running (group ${groupId}, topic ${topic})`);
      return;
    } catch (error) {
      log(
        "warn",
        `kafka consumer ${label} start attempt ${attempt} failed: ${errMessage(error)} (retrying)`,
      );
      await consumer.disconnect().catch(() => {});
      await sleep(backoffMs(attempt));
    }
  }
}

export function startConsumers(handlers: ConsumerHandlers): void {
  void runConsumer(
    GROUP_REQUESTS,
    TOPIC_REQUESTS,
    "scheduling-requests",
    handlers.onScheduleRequest,
  );
  void runConsumer(
    GROUP_DRONE_EVENTS,
    TOPIC_DRONE_EVENTS,
    "scheduling-drone-events",
    handlers.onDroneEvent,
  );
}

export async function disconnectKafka(): Promise<void> {
  try {
    await producer.disconnect();
  } catch {
    /* ignore */
  }
}
