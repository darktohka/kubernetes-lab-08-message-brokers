import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { initDb, sql, toWire, type LocationRow } from "./db";
import { decode, encode } from "./codec";

const PORT = Number(process.env.PORT ?? 3002);
const SERVICE_INSTANCE =
  process.env.SERVICE_INSTANCE ?? `${process.env.HOSTNAME ?? "location-management"}-${process.pid}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { error: "not found" } as const;
const MSGPACK = "application/msgpack";

const OPTIONAL_TEXT: Record<string, string> = {
  crop: "crop",
  agent: "agent",
  ownerName: "owner_name",
  notes: "notes",
};

type Fields = { fields: Record<string, unknown> };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a body and maps the wire fields onto column names. */
function buildFields(raw: Record<string, unknown>, partial: boolean): Fields | { error: string } {
  const fields: Record<string, unknown> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);

  if (!partial || has("name")) {
    const name = raw["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      return { error: "name must be a non-empty string" };
    }
    fields["name"] = name.trim();
  }

  if (!partial || has("lat")) {
    const lat = raw["lat"];
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { error: "lat must be a number between -90 and 90" };
    }
    fields["lat"] = lat;
  }

  if (!partial || has("lng")) {
    const lng = raw["lng"];
    if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { error: "lng must be a number between -180 and 180" };
    }
    fields["lng"] = lng;
  }

  if (has("areaHectares")) {
    const area = raw["areaHectares"];
    if (typeof area !== "number" || !Number.isFinite(area) || area < 0) {
      return { error: "areaHectares must be a number greater than or equal to 0" };
    }
    fields["area_hectares"] = area;
  } else if (!partial) {
    fields["area_hectares"] = 10;
  }

  for (const [wire, column] of Object.entries(OPTIONAL_TEXT)) {
    if (has(wire)) {
      const value = raw[wire];
      if (value === null) fields[column] = null;
      else if (typeof value === "string") fields[column] = value;
      else return { error: `${wire} must be a string or null` };
    } else if (!partial) {
      fields[column] = null;
    }
  }

  return { fields };
}

function wantsMsgpack(c: Context): boolean {
  return (c.req.header("accept") ?? "").toLowerCase().includes(MSGPACK);
}

/** Renders a payload as MessagePack when the client asked for it, JSON otherwise. */
function render(c: Context, payload: object, status: 200 | 201 = 200): Response {
  if (!wantsMsgpack(c)) return c.json(payload as never, status);
  return c.body(new Uint8Array(encode(payload)), status, { "Content-Type": MSGPACK });
}

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    if (contentType.includes(MSGPACK)) {
      const value: unknown = decode(new Uint8Array(await c.req.arrayBuffer()));
      return isObject(value) ? value : null;
    }
    const value: unknown = await c.req.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/api/locations", async (c) => {
  const rows = await sql<LocationRow[]>`
    SELECT * FROM locations ORDER BY created_at ASC, name ASC
  `;
  return render(c, { locations: rows.map(toWire) });
});

app.get("/api/locations/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(NOT_FOUND, 404);

  const [row] = await sql<LocationRow[]>`SELECT * FROM locations WHERE id = ${id}`;
  if (!row) return c.json(NOT_FOUND, 404);
  return render(c, toWire(row));
});

app.post("/api/locations", async (c) => {
  const body = await readBody(c);
  if (!body) return c.json({ error: "body must be a JSON object" }, 400);

  const parsed = buildFields(body, false);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await sql<LocationRow[]>`
    INSERT INTO locations ${sql(parsed.fields)} RETURNING *
  `;
  return c.json(toWire(row!), 201);
});

app.put("/api/locations/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(NOT_FOUND, 404);

  const body = await readBody(c);
  if (!body) return c.json({ error: "body must be a JSON object" }, 400);

  const parsed = buildFields(body, false);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await sql<LocationRow[]>`
    UPDATE locations SET ${sql(parsed.fields)}, updated_at = now()
    WHERE id = ${id} RETURNING *
  `;
  if (!row) return c.json(NOT_FOUND, 404);
  return c.json(toWire(row));
});

app.patch("/api/locations/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(NOT_FOUND, 404);

  const body = await readBody(c);
  if (!body) return c.json({ error: "body must be a JSON object" }, 400);

  const parsed = buildFields(body, true);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] =
    Object.keys(parsed.fields).length === 0
      ? await sql<LocationRow[]>`
          UPDATE locations SET updated_at = now() WHERE id = ${id} RETURNING *
        `
      : await sql<LocationRow[]>`
          UPDATE locations SET ${sql(parsed.fields)}, updated_at = now()
          WHERE id = ${id} RETURNING *
        `;
  if (!row) return c.json(NOT_FOUND, 404);
  return c.json(toWire(row));
});

app.delete("/api/locations/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(NOT_FOUND, 404);

  const rows = await sql`DELETE FROM locations WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) return c.json(NOT_FOUND, 404);
  return c.body(null, 204);
});

app.notFound((c) => c.json(NOT_FOUND, 404));

app.onError((err, c) => {
  console.error(`[location-management] ${SERVICE_INSTANCE} request failed:`, err);
  return c.json({ error: "internal server error" }, 500);
});

function retryInBackground(): void {
  setTimeout(() => {
    initDb().catch(() => retryInBackground());
  }, 10_000);
}

async function main(): Promise<void> {
  try {
    await initDb();
  } catch (err) {
    console.error(
      `[location-management] ${err instanceof Error ? err.message : String(err)}`,
      "- serving HTTP anyway, retrying in background",
    );
    retryInBackground();
  }

  Bun.serve({ port: PORT, fetch: app.fetch, idleTimeout: 0 });
  console.log(`[location-management] ${SERVICE_INSTANCE} listening on :${PORT}`);
}

void main();
