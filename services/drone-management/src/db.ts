import postgres from "postgres";

export const BASE_LAT = 46.5386;
export const BASE_LNG = 24.5578;

export const STATUSES = ["idle", "assigned", "enroute", "spraying", "returning"] as const;
export type DroneStatus = (typeof STATUSES)[number];

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://drones:dronespass@localhost:5432/drones";

export const sql = postgres(DATABASE_URL, {
  max: 10,
  connect_timeout: 10,
  onnotice: () => {},
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Drone = {
  id: string;
  name: string;
  model: string;
  status: DroneStatus;
  lat: number;
  lng: number;
  homeLat: number;
  homeLng: number;
  battery: number;
  agent: string | null;
  assignedLocationId: string | null;
  assignedLocationName: string | null;
  updatedAt: string;
};

export function toDrone(row: Record<string, any>): Drone {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    status: row.status,
    lat: row.lat,
    lng: row.lng,
    homeLat: row.home_lat,
    homeLng: row.home_lng,
    battery: row.battery,
    agent: row.agent ?? null,
    assignedLocationId: row.assigned_location_id ?? null,
    assignedLocationName: row.assigned_location_name ?? null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export function isDroneStatus(value: unknown): value is DroneStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 32-bit FNV-1a hash, used to pick a stable pad slot per drone id. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic parking pad around the base, 35-70 m out, keyed by drone id so
 * idle drones do not stack on the single base marker and stay put across restarts.
 */
export function parkingSpot(droneId: string): { lat: number; lng: number } {
  const hash = fnv1a(droneId);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const radiusM = 35 + ((hash >>> 12) % 36); // 35..70 m
  const dLat = (radiusM * Math.cos(angle)) / 111_320;
  const dLng = (radiusM * Math.sin(angle)) / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
  return {
    lat: Number((BASE_LAT + dLat).toFixed(6)),
    lng: Number((BASE_LNG + dLng).toFixed(6)),
  };
}

/** Random position on a 2-12 km circle around the base (uniform angle + radius). */
export function randomPosition(): { lat: number; lng: number } {
  const angle = Math.random() * Math.PI * 2;
  const radiusKm = 2 + Math.random() * 10;
  const dLat = (radiusKm * Math.cos(angle)) / 111.32;
  const dLng = (radiusKm * Math.sin(angle)) / (111.32 * Math.cos((BASE_LAT * Math.PI) / 180));
  return {
    lat: Number((BASE_LAT + dLat).toFixed(6)),
    lng: Number((BASE_LNG + dLng).toFixed(6)),
  };
}

const CREATE_DRONES = `
  CREATE TABLE IF NOT EXISTS drones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    model text NOT NULL DEFAULT 'DJI Agras T40',
    status text NOT NULL DEFAULT 'idle',
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    home_lat double precision NOT NULL,
    home_lng double precision NOT NULL,
    battery int NOT NULL DEFAULT 100,
    agent text,
    assigned_location_id uuid,
    assigned_location_name text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;

const CREATE_APPLIED_COMMANDS = `
  CREATE TABLE IF NOT EXISTS applied_commands (
    command_id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

/** Idempotent migration with retries so the pod survives a slow Postgres. */
export async function migrate(): Promise<boolean> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await sql.unsafe(CREATE_DRONES);
      await sql.unsafe(CREATE_APPLIED_COMMANDS);
      console.log("[db] migration ok");
      return true;
    } catch (err) {
      console.warn(`[db] migration attempt ${attempt}/10 failed:`, (err as Error).message);
      await sleep(2000);
    }
  }
  console.error("[db] migration failed after 10 attempts");
  return false;
}

/** Seed Falcon-01..06 when the table is empty. */
export async function seed(): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM drones`;
      if (Number(row?.count ?? 0) > 0) {
        console.log(`[db] ${row.count} drones present, seed skipped`);
        return;
      }
      const drones = Array.from({ length: 6 }, (_, i) => {
        const position = randomPosition();
        return {
          name: `Falcon-${String(i + 1).padStart(2, "0")}`,
          lat: position.lat,
          lng: position.lng,
          battery: 70 + Math.floor(Math.random() * 31),
        };
      });
      for (const d of drones) {
        await sql`
          INSERT INTO drones (name, lat, lng, home_lat, home_lng, battery, status)
          VALUES (${d.name}, ${d.lat}, ${d.lng}, ${BASE_LAT}, ${BASE_LNG}, ${d.battery}, 'idle')
          ON CONFLICT (name) DO NOTHING`;
      }
      console.log("[db] seeded 6 drones");
      return;
    } catch (err) {
      console.warn(`[db] seed attempt ${attempt}/10 failed:`, (err as Error).message);
      await sleep(2000);
    }
  }
  console.error("[db] seed failed after 10 attempts");
}

export async function initDb(): Promise<void> {
  const ok = await migrate();
  if (ok) await seed();
}
