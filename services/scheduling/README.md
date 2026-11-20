# scheduling (`:3003`)

Scheduling API + Kafka workers + mission simulator. Implements section 3 of
`docs/CONTRACT.md`.

## Run

```bash
bun install
PORT=3003 \
DATABASE_URL=postgres://scheduling:schedpass@localhost:5432/scheduling \
KAFKA_BROKERS=localhost:9092 \
REDIS_URL=redis://localhost:6379 \
DRONE_SERVICE_URL=http://localhost:3001 \
LOCATION_SERVICE_URL=http://localhost:3002 \
bun run src/index.ts
```

Scripts: `bun run start`, `bun run dev` (watch), `bun run typecheck`.

## Layout

| file | responsibility |
|---|---|
| `src/index.ts` | Hono routes, SSE endpoint, Kafka message handlers, bootstrap/shutdown |
| `src/db.ts` | postgres client, idempotent migrations (retried 10x / 2 s) |
| `src/wire.ts` | row types, camelCase wire mappers, `GET /state` aggregate |
| `src/sse.ts` | SSE client registry, `state`/`positions` broadcasts, 5 s state heartbeat |
| `src/clients.ts` | time-boxed HTTP clients for location/drone services |
| `src/kafka.ts` | producer, topic bootstrap, consumer groups (retrying connects) |
| `src/redis.ts` | `drone.positions` publisher + subscriber -> SSE |
| `src/assign.ts` | `tryAssign()` reconciler (advisory lock + `FOR UPDATE SKIP LOCKED`) |
| `src/simulator.ts` | leader election (advisory lock 918273) + 1 s mission tick |

## Columns added beyond the contract

Both are on `missions` (added via `ADD COLUMN IF NOT EXISTS`, so upgrades are safe):

- `phase_started_at timestamptz NOT NULL DEFAULT now()` — start of the current
  simulator phase (observability; the phase itself is derived from `started_at`).
- `battery_start int` — battery reported by the drone when the mission was
  created. Battery is computed as `battery_start - 0.5 * flying_seconds`
  (floor 5), so a leader failover does not reset the drain.

Neither column changes the contract's wire shape; they are exposed as
`phaseStartedAt` / `batteryStart` in mission JSON.

## Behaviour notes

- **Leader/follower.** The simulator takes a *session* advisory lock
  (`pg_try_advisory_lock(918273)`) on a dedicated reserved connection held for
  the process lifetime. Followers log once and never tick. If the connection
  dies, the pod drops leadership and re-elects every 10 s.
- **Assignment across replicas** is serialised by
  `pg_try_advisory_xact_lock(918274)`; the loser skips and retries in 5 s.
- **Failed Kafka publishes.** `POST /requests` still returns `202` (the DB row
  is the source of truth). Assign commands that cannot be published are queued
  in memory and re-published by the 5 s reconciler while the mission is still
  active.
- **`state` SSE frames** are emitted on change *and* every 5 s on every replica,
  so follower pods still feed the frontend.
- The broker in this environment auto-creates topics with 1 partition; the
  service creates any missing topic with 3 partitions explicitly and leaves
  existing topics untouched.
