# Drone-As-A-Service — Interface Contract (authoritative)

Spraying-drone rental platform for Târgu Mureș. Three Bun microservices + one Vite
frontend. Everything below is fixed; do not rename fields, ports or paths.

Base coordinates: **Târgu Mureș = lat 46.5386, lng 24.5578**. The drone base
(home) is exactly that point. Operating radius around the city: 15 km.

## Runtime stack (every service)

- Bun 1.4.x runtime, TypeScript, no build step for the backend (`bun run src/index.ts`).
- HTTP: `hono` (pin `4.13.19`), served with `Bun.serve({ port, fetch: app.fetch, idleTimeout: 0 })`.
- Postgres: `postgres` (porsager) pin `4.1.1`.
- Kafka: `kafkajs` pin `2.2.4`.
- Redis: `ioredis` pin `5.11.1`.
- `package.json` scripts: `"start": "bun run src/index.ts"`, `"dev": "bun run --watch src/index.ts"`, `"typecheck": "tsc --noEmit"`.
- `tsconfig.json`: `{"compilerOptions": {"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"skipLibCheck":true,"types":["bun-types"],"noEmit":true,"allowImportingTsExtensions":true,"verbatimModuleSyntax":true}}` (use `"types": ["bun"]` if `@types/bun` is installed; install `@types/bun@1.4.5` and `typescript@5.9.3` as devDeps).
- Every service: `GET /healthz` → `200 {"status":"ok"}` that works even if deps are down.
- JSON errors: `{ "error": "<message>" }` with 4xx/5xx.
- CORS: allow all origins, methods, headers (frontend is served from the same host but keep it permissive).
- Never crash on startup because Kafka/Redis is briefly unavailable: retry with backoff, log, keep serving HTTP.

## Environment variables

| var | used by | default |
|---|---|---|
| `PORT` | all | 3001 / 3002 / 3003 |
| `DATABASE_URL` | all | `postgres://drones:dronespass@localhost:5432/drones` (per service) |
| `KAFKA_BROKERS` | all | `localhost:9092` (comma separated) |
| `REDIS_URL` | all | `redis://localhost:6379` |
| `DRONE_SERVICE_URL` | scheduling | `http://localhost:3001` |
| `LOCATION_SERVICE_URL` | scheduling | `http://localhost:3002` |
| `SERVICE_INSTANCE` | all | hostname + pid, used for logs |

Kafka client config: `clientId: <service-name>`, `brokers: KAFKA_BROKERS.split(",")`,
`retry: { retries: 20, initialRetryTime: 500 }`, `logLevel: logLevel.WARN`.

## Wire encoding between services

Service-to-service payloads are **MessagePack**, not JSON text. HTTP remains JSON
for the browser (the frontend and the SSE stream), everything else is binary:

- Kafka message `value` and Redis pub/sub payloads are MessagePack frames produced
  with `msgpackr` (`new Packr({ useRecords: false, mapsAsObjects: true })`, pinned
  `msgpackr@2.1.4`). Message *keys* stay plain strings — they are routing keys.
- Internal HTTP calls (`GET /api/locations/:id`, `GET /api/drones`,
  `PATCH /api/drones/:id`) negotiate: the caller sends
  `Accept: application/msgpack` and/or `Content-Type: application/msgpack`; the
  callee answers in MessagePack when asked and falls back to JSON otherwise.
- Decoders must stay backward compatible for one release: a UTF-8 body starting
  with `{` (0x7b) is parsed as JSON.
- Every service carries the same `src/codec.ts`:

```ts
import { Packr } from "msgpackr";

const packr = new Packr({ useRecords: false, mapsAsObjects: true });

export function encode(value: unknown): Buffer {
  return packr.pack(value);
}

/** Decodes a MessagePack frame; tolerates legacy JSON text for one release. */
export function decode<T>(input: Uint8Array | Buffer | string): T {
  if (typeof input === "string") return JSON.parse(input) as T;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length > 0 && bytes[0] === 0x7b) return JSON.parse(bytes.toString("utf8")) as T;
  return packr.unpack(bytes) as T;
}
```

Payload *shapes* below are unchanged — they describe the object that is encoded.

## Kafka topics (auto-created, 3 partitions each)

1. `schedule.requests` — **producer:** scheduling API. **consumer group:** `scheduling-requests`.
   Message key = request id (string). Value (MessagePack-encoded object):
   ```json
   {"messageId":"<uuid>","requestId":"<uuid>","locationId":"<uuid>","droneCount":1,
    "agent":"Herbicide","startsAt":"iso","endsAt":"iso","at":"iso"}
   ```
   Exactly-one-consumer demo: the request is enqueued on Kafka and processed by exactly
   one member of the group; processing is idempotent via `messageId` (unique column).
2. `drone.events` — **producer:** drone-management. **consumer group:** `scheduling-drone-events`.
   Key = drone id (string). Value (MessagePack) `{"type":"drone.status","droneId":"<uuid>","status":"idle","at":"iso"}`.
3. `drone.commands` — **producer:** scheduling. **consumer group:** `drone-management-commands`.
   Key = drone id (string). Value (MessagePack):
   ```json
   {"commandId":"<uuid>","type":"assign","droneId":"<uuid>","missionId":"<uuid>",
    "locationId":"<uuid>","locationName":"Plot A","lat":46.5,"lng":24.6,"agent":"Herbicide","at":"iso"}
   ```
   On receipt drone-management sets `status = 'assigned'`, `assigned_location_id/name`,
   `agent`, and emits a `drone.events` message. Idempotent by `commandId`.

## Redis pub/sub

Channel `drone.positions`. Payload (**MessagePack-encoded object**, published as a Buffer):
```json
{"droneId":"<uuid>","missionId":"<uuid>|null","lat":46.5,"lng":24.6,
 "battery":87,"status":"enroute","progress":0.42,"ts":1699999999}
```
- **Publisher:** scheduling simulator, once per tick (~1 s) per moving drone.
- **Consumer A:** drone-management — decodes the frame, persists `lat/lng/battery/status`
  (throttle DB writes to at most 1/s per drone).
- **Consumer B:** scheduling — decodes the frame and re-encodes it as **JSON** for SSE clients
  (`/api/scheduling/stream`), because EventSource only speaks text.
This is the fan-out demo: one published message, two independent subscribers.

---

## 1. drone-management (`:3001`)

DB `drones`, table owned by this service. Schema (create at startup, `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS drones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  model text NOT NULL DEFAULT 'DJI Agras T40',
  status text NOT NULL DEFAULT 'idle',           -- idle | assigned | enroute | spraying | returning
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  home_lat double precision NOT NULL,
  home_lng double precision NOT NULL,
  battery int NOT NULL DEFAULT 100,
  agent text,
  assigned_location_id uuid,
  assigned_location_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seed when empty: 6 drones `Falcon-01` … `Falcon-06`, home = base coords, random position on a
circle 2–12 km around the base (uniform angle + uniform radius), battery 70–100.

### JSON drone object (camelCase on the wire)
```json
{"id":"uuid","name":"Falcon-01","model":"DJI Agras T40","status":"idle",
 "lat":46.53,"lng":24.55,"homeLat":46.5386,"homeLng":24.5578,"battery":100,
 "agent":null,"assignedLocationId":null,"assignedLocationName":null,"updatedAt":"iso"}
```

### Endpoints (mounted under `/api/drones`)
- `GET /api/drones` → `{"drones":[Drone]}`; optional `?status=idle`; honours `Accept: application/msgpack`.
- `GET /api/drones/:id` → Drone or `404 {"error":"not found"}`.
- `POST /api/drones` body `{name?, model?, lat?, lng?}` → `201 Drone` (random position if lat/lng missing).
- `PATCH /api/drones/:id` accepts any of `{status, lat, lng, battery, agent, assignedLocationId, assignedLocationName}` → `200 Drone`. **Publishes `drone.events` when `status` changes** (previous status vs new).
- `POST /api/drones/:id/reset` → `200 Drone`: status `idle`, position back to home, battery 100, assignment cleared, publishes `drone.events`.
- `GET /api/drones/stats` → `{"total":6,"idle":4,"busy":2}`.

Also consumes `drone.commands` (group `drone-management-commands`) and subscribes to
`drone.positions`.

---

## 2. location-management (`:3002`)

DB `locations`, table created at startup:

```sql
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
);
```

Wire object: `{"id","name","lat","lng","areaHectares","crop","agent","ownerName","notes","createdAt","updatedAt"}`.

Seed when empty: 5 plots with real-ish coordinates 3–13 km around the base, e.g.
"Luncani Wheat Field" (46.5750,24.6100, 42 ha, wheat, Herbicide), "Sâncraiu Verde" (46.5000,24.4900, 18 ha, maize, Fungicide),
"Platoul Cornești" (46.5270,24.5330, 12 ha, orchard, Insecticide), "Mureș Riverside" (46.5450,24.5750, 25 ha, vegetables, Herbicide),
"Acriș Vineyard" (46.4900,24.6100, 9 ha, vineyard, Fungicide).

### Endpoints (mounted under `/api/locations`)
- `GET /api/locations` → `{"locations":[Location]}`
- `GET /api/locations/:id` → Location or 404
- `POST /api/locations` body `{name, lat, lng, areaHectares?, crop?, agent?, ownerName?, notes?}` → `201 Location`
- `PUT /api/locations/:id` full update, `PATCH /api/locations/:id` partial → `200 Location`
- `DELETE /api/locations/:id` → `204` (no body)
- Validation: `name` non-empty, `lat` in [-90,90], `lng` in [-180,180] → else `400 {"error":...}`.

---

## 3. scheduling (`:3003`)

DB `scheduling`, tables created at startup:

```sql
CREATE TABLE IF NOT EXISTS schedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id text UNIQUE,                  -- idempotency (Kafka)
  location_id uuid NOT NULL,
  location_name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  drone_count int NOT NULL DEFAULT 1,
  agent text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',          -- queued | assigned | done | cancelled
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  status text NOT NULL DEFAULT 'assigned',         -- assigned | enroute | spraying | returning | done
  progress double precision NOT NULL DEFAULT 0,
  lat_now double precision,
  lng_now double precision,
  battery int,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (request_id, drone_id)
);
```

Wire objects mirror the columns in camelCase (`latNow`, `lngNow`, `requestId`, `droneId`, …).

### Endpoints (mounted under `/api/scheduling`)
- `POST /api/scheduling/requests` body `{locationId, droneCount?, startsAt?, endsAt?, agent?}`
  → `202 {"request": Request}`. Fetches the location from `LOCATION_SERVICE_URL/api/locations/:id`
  (400 if it 404s), inserts with `status='queued'`, `source_message_id = uuid`, then publishes to
  Kafka `schedule.requests`. Defaults: `droneCount=1`, `startsAt=now`, `endsAt=startsAt+30min`.
- `GET /api/scheduling/requests` → `{"requests":[Request]}` newest first.
- `DELETE /api/scheduling/requests/:id` → `200 {"request": Request}` with `status='cancelled'`
  (also cancels its non-done missions). 404 if unknown.
- `GET /api/scheduling/missions` → `{"missions":[Mission]}` newest first.
- `GET /api/scheduling/state` → `{"requests":[…],"missions":[…],"kafka":{"connected":true},"instances":1}`.
- `GET /api/scheduling/stream` → **SSE**. On connect send `event: state` with the full state JSON;
  then `event: positions` with `{"positions":[{droneId,lat,lng,battery,status,progress}]}` on every
  simulator tick (max 1/s), and `event: state` whenever a request/mission changes. Keep-alive comment
  `: ping` every 15 s. No auth.
- `GET /healthz`.

### Workers
- Consumer group `scheduling-requests` on `schedule.requests`: idempotent
  `INSERT … ON CONFLICT (source_message_id) DO NOTHING`, then `tryAssign()`.
- Consumer group `scheduling-drone-events` on `drone.events`: if `status === 'idle'` → `tryAssign()`.
- `tryAssign()` (every 5 s also on a timer):
  - Claim up to 5 queued requests with `SELECT … FOR UPDATE SKIP LOCKED` (own transaction).
  - Fetch drones: `GET {DRONE_SERVICE_URL}/api/drones` → take drones with `status === 'idle'`.
  - For each request needing N drones: create one mission per drone (`assigned`), publish a
    `drone.commands` assign message per mission, then mark request `assigned` when all N assigned
    (leave `queued` if not enough drones are free yet; already-created missions count as assigned).
  - Must never assign the same drone twice concurrently (`UPDATE … SET status` guard is remote, so rely
    on mission uniqueness + re-reading fresh drone status; a drone already in an active mission here must be skipped).
- **Simulator** (single leader via Postgres advisory lock `pg_try_advisory_lock(918273)`; if not leader,
  do nothing):
  - Tick every 1000 ms. Mission timeline: `assigned`→`enroute` (18 s) →`spraying` (30 s) →`returning`
    (18 s) →`done`. Interpolate position: home→plot, small circle pattern around the plot while
    spraying (radius ~120 m), plot→home. Battery drains ~1 point per 2 s while flying.
  - Publish each tick to Redis `drone.positions`, update `missions` row (`status`, `progress`,
    `lat_now`, `lng_now`, `battery`), and push `state`/`positions` to SSE clients.
  - On phase change, `PATCH {DRONE_SERVICE_URL}/api/drones/:id` with `{status, lat, lng, battery, agent}`.
  - On completion, `PATCH` drone with `{status:"idle"}` (drone-management resets position home), set
    mission `done` + `completed_at`, and mark the request `done` when all its missions are done.
- Kafkajs `eachMessage` handlers must catch errors per message (log + continue).

---

## 4. Frontend (`:8080`, Vite + React + TS + Leaflet)

- Calls the API with **relative** URLs (`/api/…`) — same origin behind the ingress.
- Vite dev proxy maps `/api/drones` → `http://localhost:3001`, `/api/locations` →
  `http://localhost:3002`, `/api/scheduling` → `http://localhost:3003`.
- Map: Leaflet + OpenStreetMap raster tiles, centered 46.5386/24.5578, zoom 12; a 15 km circle
  showing the operating radius; layer control optional.
- Live drone positions from `EventSource("/api/scheduling/stream")` (`positions` + `state` events),
  with a polling fallback of `GET /api/drones` every 3 s if SSE fails.
- Must support: add location (click on map), edit location (drag marker / click map), list drones with
  status + battery, schedule drones for a location (count, agent, start/end).
- Static build output goes to `dist/`, served by nginx on port 8080 (SPA fallback to `index.html`).
