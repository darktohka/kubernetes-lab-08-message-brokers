import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://locations:locationspass@localhost:5432/locations";

export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5,
  onnotice: () => {},
});

export type LocationRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  area_hectares: number;
  crop: string | null;
  agent: string | null;
  owner_name: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export type LocationWire = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  areaHectares: number;
  crop: string | null;
  agent: string | null;
  ownerName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toWire(row: LocationRow): LocationWire {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    areaHectares: row.area_hectares,
    crop: row.crop,
    agent: row.agent,
    ownerName: row.owner_name,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const SEED = [
  {
    name: "Luncani Wheat Field",
    lat: 46.575,
    lng: 24.61,
    area: 42,
    crop: "wheat",
    agent: "Herbicide",
    owner: "Ion Popescu",
    notes: "Flat parcel east of the city",
  },
  {
    name: "Sâncraiu Verde",
    lat: 46.5,
    lng: 24.49,
    area: 18,
    crop: "maize",
    agent: "Fungicide",
    owner: "Maria Kovács",
    notes: "Small maize plot south-west of town",
  },
  {
    name: "Platoul Cornești",
    lat: 46.527,
    lng: 24.533,
    area: 12,
    crop: "orchard",
    agent: "Insecticide",
    owner: "Andrei Szabó",
    notes: "Orchard on the Cornești plateau",
  },
  {
    name: "Mureș Riverside",
    lat: 46.545,
    lng: 24.575,
    area: 25,
    crop: "vegetables",
    agent: "Herbicide",
    owner: "Elena Mureșan",
    notes: "Irrigated strip along the Mureș",
  },
  {
    name: "Acriș Vineyard",
    lat: 46.49,
    lng: 24.61,
    area: 9,
    crop: "vineyard",
    agent: "Fungicide",
    owner: "Radu Bartha",
    notes: "Sloped vineyard, fly low",
  },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function seedIfEmpty(): Promise<void> {
  for (const plot of SEED) {
    // Guard per plot name (not "table empty") so every plot is seeded exactly once,
    // even if several replicas boot at the same time.
    await sql`
      INSERT INTO locations (name, lat, lng, area_hectares, crop, agent, owner_name, notes)
      SELECT ${plot.name}, ${plot.lat}, ${plot.lng}, ${plot.area},
             ${plot.crop}, ${plot.agent}, ${plot.owner}, ${plot.notes}
      WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = ${plot.name})
    `;
  }
}

async function migrate(): Promise<void> {
  await sql`SELECT 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS locations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      lat double precision NOT NULL,
      lng double precision NOT NULL,
      area_hectares double precision NOT NULL DEFAULT 10,
      crop text,
      agent text,
      owner_name text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await seedIfEmpty();
}

/** Retries the migration ~10 times, 2s apart, then throws once. */
export async function initDb(attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await migrate();
      console.log("[location-management] database ready");
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === attempts) {
        throw new Error(`database init failed after ${attempts} attempts: ${message}`);
      }
      console.error(
        `[location-management] db init attempt ${attempt}/${attempts} failed: ${message} - retrying in 2s`,
      );
      await sleep(2000);
    }
  }
}
