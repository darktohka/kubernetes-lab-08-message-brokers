// SSE client registry and broadcast helpers.
//
// Every replica serves SSE, so `state` is broadcast on change *and* on a 5 s
// heartbeat that does not depend on the simulator leader.
import { errMessage, log } from "./config.ts";
import { getState } from "./wire.ts";

/** Minimal structural view of Hono's SSEStreamingApi. */
export interface SseClient {
  write(chunk: string): Promise<unknown>;
}

const clients = new Set<SseClient>();

export function addClient(client: SseClient): void {
  clients.add(client);
}

export function removeClient(client: SseClient): void {
  clients.delete(client);
}

export function clientCount(): number {
  return clients.size;
}

export function broadcast(event: string, data: unknown): void {
  if (clients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame).catch(() => {
        clients.delete(client);
      });
    } catch {
      clients.delete(client);
    }
  }
}

/** Pushes the full (requests, missions, kafka, instances) payload to every client. */
export async function broadcastState(): Promise<void> {
  if (clients.size === 0) return;
  try {
    broadcast("state", await getState());
  } catch (error) {
    log("warn", `state broadcast failed: ${errMessage(error)}`);
  }
}

/**
 * Unconditional 5 s state heartbeat. Runs on every replica (leader or not) so
 * follower pods keep the frontend's queue/mission view up to date.
 */
export function startStateHeartbeat(intervalMs = 5000): void {
  setInterval(() => {
    void broadcastState();
  }, intervalMs);
}
