// Postgres connection + startup migrations.
//
// The service must never crash-loop because Postgres is briefly unavailable:
// migrations are retried and failure is logged, HTTP keeps serving.
import postgres from "postgres";
import { DATABASE_URL, errMessage, log, sleep } from "./config.ts";

export const sql = postgres(DATABASE_URL, {
  max: 10,
  connect_timeout: 10,
  idle_timeout: 30,
  // Notices (e.g. "relation already exists") are noise for us.
  onnotice: () => {},
});

/**
 * Migrations are plain idempotent DDL statements, executed in order.
 *
 * Columns added beyond docs/CONTRACT.md (documented in the README/report):
 *  - missions.phase_started_at timestamptz  start of the current simulator phase
 *  - missions.battery_start    int          drone battery when the mission was created,
 *                                           so battery drain survives a leader restart
 */
const MIGRATIONS: { name: string; ddl: string }[] = [
  {
    name: "schedule_requests",
    ddl: `
      CREATE TABLE IF NOT EXISTS schedule_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_message_id text UNIQUE,
        location_id uuid NOT NULL,
        location_name text NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        drone_count int NOT NULL DEFAULT 1,
        agent text,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: "missions",
    ddl: `
      CREATE TABLE IF NOT EXISTS missions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES schedule_requests(id) ON DELETE CASCADE,
        drone_id uuid NOT NULL,
        drone_name text NOT NULL,
        location_id uuid NOT NULL,
        location_name text NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        agent text,
        status text NOT NULL DEFAULT 'assigned',
        progress double precision NOT NULL DEFAULT 0,
        lat_now double precision,
        lng_now double precision,
        battery int,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        phase_started_at timestamptz NOT NULL DEFAULT now(),
        battery_start int,
        UNIQUE (request_id, drone_id)
      )
    `,
  },
  {
    name: "missions.phase_started_at (existing tables)",
    ddl: `ALTER TABLE missions ADD COLUMN IF NOT EXISTS phase_started_at timestamptz NOT NULL DEFAULT now()`,
  },
  {
    name: "missions.battery_start (existing tables)",
    ddl: `ALTER TABLE missions ADD COLUMN IF NOT EXISTS battery_start int`,
  },
  {
    name: "idx_schedule_requests_status",
    ddl: `CREATE INDEX IF NOT EXISTS schedule_requests_status_idx ON schedule_requests (status)`,
  },
  {
    name: "idx_missions_status",
    ddl: `CREATE INDEX IF NOT EXISTS missions_status_idx ON missions (status)`,
  },
  {
    name: "idx_missions_request",
    ddl: `CREATE INDEX IF NOT EXISTS missions_request_idx ON missions (request_id)`,
  },
];

export async function migrate(): Promise<boolean> {
  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      for (const migration of MIGRATIONS) {
        await sql.unsafe(migration.ddl);
      }
      log("info", `migrations applied (${MIGRATIONS.length} statements)`);
      return true;
    } catch (error) {
      log(
        "warn",
        `migration attempt ${attempt}/${attempts} failed: ${errMessage(error)}`,
      );
      if (attempt < attempts) await sleep(2000);
    }
  }
  log("error", "migrations failed after 10 attempts; serving HTTP without schema");
  return false;
}
