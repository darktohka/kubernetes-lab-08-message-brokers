// Runtime configuration, logging and small shared helpers.
import { hostname } from "node:os";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envList(name: string, fallback: string): string[] {
  const raw = process.env[name] ?? fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function envUrl(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).replace(/\/+$/, "");
}

export const PORT = envInt("PORT", 3003);
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://scheduling:schedpass@localhost:5432/scheduling";
export const KAFKA_BROKERS = envList("KAFKA_BROKERS", "localhost:9092");
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const DRONE_SERVICE_URL = envUrl("DRONE_SERVICE_URL", "http://localhost:3001");
export const LOCATION_SERVICE_URL = envUrl("LOCATION_SERVICE_URL", "http://localhost:3002");
export const SERVICE_INSTANCE =
  process.env.SERVICE_INSTANCE ?? `${hostname()}-${process.pid}`;

export const KAFKA_CLIENT_ID = "scheduling";

export function log(level: "info" | "warn" | "error", message: string, extra?: unknown): void {
  const line = `[scheduling][${SERVICE_INSTANCE}] ${level.toUpperCase()} ${message}`;
  if (extra !== undefined) {
    if (level === "error") console.error(line, extra);
    else if (level === "warn") console.warn(line, extra);
    else console.log(line, extra);
    return;
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
