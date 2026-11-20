# Lab 08 - Spraying Drones as a Service - Târgu Mureș

A small but complete microservice platform for a company that rents agricultural
spraying drones by the hour. Customers pick a plot on a map, choose how many
drones and which spraying agent they need, and watch the fleet fly out, spray,
and come home - live.

Everything runs in the `dani` namespace of the course cluster and is reachable at
**https://dronemandaniel.sapi.click**.

```
                          ┌──────────────────────────┐
   browser ──────────────►│ Traefik ingress          │
                          │ dronemandaniel.sapi.click│
                          └───┬───────┬───────┬──────┘
             /api/drones      │       │       │   /api/scheduling
                     ┌────────▼──┐ ┌──▼───────┐ ┌▼──────────────┐   /  ─► frontend
                     │ drone-    │ │ location-│ │ scheduling    │        (nginx, Vite build)
                     │ management│ │ management│ │ ×2 replicas  │
                     └──┬───┬────┘ └──┬───────┘ └──┬─────┬──────┘
                        │   │         │            │     │
        drone.commands  │   │         │            │     │  schedule.requests
        (consume)  ┌────▼───▼─────────▼────────────▼─┐   │
                    │  Kafka (Strimzi, KRaft, 1 node)│◄──┘
                    │  drone.events / drone.commands │
                    │  schedule.requests             │
                    └────────────────────────────────┘
                        │                                   ▲
        drone.events    │                                   │ assign
        (produce)       │                                   │
                        ▼                                   │
   scheduling ──publish──► Redis pub/sub `drone.positions` ─┴─► SSE ──► browser
   (simulator)                 │
                               └── subscribe: drone-management (persists positions)
                                   subscribe: scheduling (forwards to SSE clients)

   Postgres: CloudNativePG cluster `drones-pg` → databases drones | locations | scheduling
```

## Services

| service | port | database | messaging | responsibility |
|---|---|---|---|---|
| `drone-management` | 3001 | `drones` | produces `drone.events`, consumes `drone.commands`, subscribes `drone.positions` | the fleet registry: what drones exist, where they are, what they are doing, battery, loaded agent |
| `location-management` | 3002 | `locations` | - | the agricultural plots a customer can rent drones for |
| `scheduling` | 3003 | `scheduling` | produces `schedule.requests` + `drone.commands`, consumes `schedule.requests` + `drone.events`, publishes `drone.positions` | the queue: turns rental requests into missions, assigns free drones, simulates the flight, streams live positions over SSE |
| `frontend` | 8080 | - | - | Vite + React + Leaflet operations console |

### Why Kafka *and* Redis

The two brokers are used for the two different delivery semantics, not as
interchangeable queues:

- **Kafka - work distribution (exactly one consumer).** A rental request is
  published to `schedule.requests` and consumed by the `scheduling-requests`
  consumer group. With two scheduling replicas the topic's three partitions are
  split across the group members, so every message is processed by exactly one
  replica. Processing is idempotent on `messageId` (`schedule_requests.source_message_id`
  is `UNIQUE` + `ON CONFLICT DO NOTHING`), which is what makes at-least-once
  delivery safe. Assignments travel the other way as `drone.commands`, consumed
  by the `drone-management-commands` group.
- **Redis - fan-out (every subscriber sees every message).** The simulator
  publishes one JSON message per drone per second on the `drone.positions`
  channel. Two independent subscribers consume it: `drone-management` persists
  the position, and `scheduling` forwards it to every connected SSE client. One
  publish, many readers - the classic pub/sub pattern.

### Wire format

Everything the services say to each other is **MessagePack** (`msgpackr`,
`useRecords: false`), not JSON text: Kafka record values, Redis pub/sub payloads,
and the request/response bodies of internal HTTP calls (`Accept`/`Content-Type:
application/msgpack`, with JSON kept as the fallback). That includes the two
`drone.positions` consumers and the assign commands.

JSON survives only where a browser is on the other end - the public REST API and
the SSE stream (EventSource is text-only), so scheduling decodes the binary
telemetry and re-encodes it as JSON per client. Decoders still accept a payload
that starts with `{` so a rolling deploy cannot split the fleet across formats.

You can watch the group split yourself:

```bash
kubectl exec -n dani drones-kafka-dual-role-0 -- \
  /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group scheduling-requests
```

### Scheduling algorithm

1. `POST /api/scheduling/requests` resolves the plot through `location-management`,
   stores the request as `queued`, and publishes it to Kafka.
2. A consumer (exactly one replica) inserts it idempotently and calls `tryAssign()`.
3. `tryAssign()` claims queued requests with `SELECT … FOR UPDATE SKIP LOCKED`,
   reads the fleet, skips drones already in an active mission, creates one mission
   per drone and publishes a `drone.commands` assign message for each. Not enough
   free drones means the request simply stays queued and the 5 s reconciler retries
   - drones coming back online emit `drone.events`, which triggers another attempt.
4. Exactly one replica holds the Postgres advisory lock `918273` and runs the flight
   simulator: `assigned → enroute (18 s) → spraying (30 s) → returning (18 s) → done`,
   with a small spray pattern around the plot, battery drain, per-tick Redis
   publishes, and drone PATCHes on every phase change.

## Repository layout

```
services/drone-management/    Bun + Hono + Postgres + Kafka + Redis subscriber
services/location-management/ Bun + Hono + Postgres
services/scheduling/          Bun + Hono + Postgres + Kafka (2 groups) + Redis pub/sub + SSE
frontend/                     Vite + React + TypeScript + Leaflet
k8s/                          Kubernetes manifests (see below)
docs/CONTRACT.md              the interface contract the services were built against
Makefile                      build / push / deploy / verify shortcuts
```

Every service is self-contained (own `package.json`, own Dockerfile, its own
database) and migrates its schema on boot, so there is no shared library and no
deployment ordering beyond the infrastructure.

## Infrastructure

| component | how it is provided |
|---|---|
| PostgreSQL | **CloudNativePG** `Cluster` `drones-pg` (1 instance, 2 Gi `local-path`). One database per service (`drones`, `locations`, `scheduling`), created by the idempotent `db-init` Job, which is also the only consumer of the generated superuser secret. |
| Kafka | **Strimzi** operator, mode KRaft, single `KafkaNodePool` (controller+broker). Topics are declared as `KafkaTopic` CRs: `schedule.requests`, `drone.events`, `drone.commands` (3 partitions each, RF 1). |
| Redis | **Redis Operator** (`redis.redis.opstreelabs.in/v1beta2`), one `Redis` CR, emptyDir, provides `redis:6379`. |
| Secrets | `lighthouse-registry` (image pull), `drones-db` (three `DATABASE_URL`s + provisioning passwords), CNPG-managed `drones-pg-app`/`drones-pg-superuser`. |
| Ingress | Traefik, host `dronemandaniel.sapi.click`, path routing (`/api/scheduling`, `/api/drones`, `/api/locations`, `/`). |

Manifest order:

```
k8s/00-rbac.yaml                 one-time grant for the operators' CRDs (admin)
k8s/00-strimzi-clusterwide.yaml  one-time cluster-wide operator wiring (admin)
k8s/01-secrets.yaml              pull secret, database URLs, shared ConfigMap
k8s/02-postgres-cluster.yaml     CloudNativePG Cluster
k8s/03-db-init-job.yaml          roles + databases (idempotent Job)
k8s/04-kafka.yaml                Strimzi KafkaNodePool + Kafka + KafkaTopics
k8s/05-redis.yaml                Redis CR
k8s/20..22-*.yaml                the three microservices
k8s/23-frontend.yaml             the frontend Deployment + Service
k8s/30-ingress.yaml              path routing for the public host
```

## Build & deploy

```bash
cp k8s/01-secrets.example.yaml k8s/01-secrets.yaml   # fill in the registry + DB passwords
make release      # build all four images (linux/arm64) and push to lighthouse.tohka.us/drone-management
make infra        # secrets, Postgres, Kafka, Redis (+ wait for the cluster)
make db           # provision roles/databases
make deploy       # services + ingress
make verify       # smoke-test the public endpoints
```

`make build` passes `--platform linux/arm64` because the worker nodes are
aarch64. Each Dockerfile pins its **build stage** to `--platform=$BUILDPLATFORM`
so `bun install` + `bun build` run natively on the x86_64 workstation and only
the finished JavaScript bundle is copied into the arm64 runtime image - a rebuild
takes about a second. Images are pushed without provenance/SBOM attestations,
because the cluster's containerd rejects the `unknown/unknown` attestation
manifest ("no match for platform in manifest").

## API

All endpoints are served under the same host, so the frontend uses relative URLs.

```
GET    /api/drones                     list the fleet
GET    /api/drones/stats               {total, idle, busy}
GET    /api/drones/:id
POST   /api/drones                     {name, model?}
PATCH  /api/drones/:id                 {status, lat, lng, battery, agent, assignedLocationId, assignedLocationName}
POST   /api/drones/:id/reset           park at base, battery 100, idle

GET    /api/locations                  list plots
GET    /api/locations/:id
POST   /api/locations                  {name, lat, lng, areaHectares, crop, agent, ownerName, notes}
PUT    /api/locations/:id              full replace
PATCH  /api/locations/:id              partial update
DELETE /api/locations/:id

POST   /api/scheduling/requests        {locationId, droneCount, agent?, startsAt?, endsAt?}
GET    /api/scheduling/requests        the queue
DELETE /api/scheduling/requests/:id    cancel (also cancels pending missions)
GET    /api/scheduling/missions        missions with status/progress
GET    /api/scheduling/state           full snapshot
GET    /api/scheduling/stream          SSE: `state` + `positions` events
```

The full field-level contract is in [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Frontend

Operations console: Leaflet map centred on Târgu Mureș with the 15 km operating
radius, plot markers that can be created by clicking the map and edited by moving
them, live drone markers fed by SSE (with polling fallback), a fleet panel with
battery/status, and a scheduling panel showing the queue and mission progress.
No authentication - it is a demo, and the ingress is the only entry point.

## Operational notes

- **Kafka readiness.** The broker advertises `drones-kafka-kafka-bootstrap:9092`;
  a topic-listing probe on the service would deadlock against a not-yet-Ready pod,
  so the Service uses `publishNotReadyAddresses` and readiness is a TCP probe.
- **Strimzi scope.** The upstream bundle installs namespaced. To let every tenant
  namespace run Kafka, the operator was switched to cluster-wide mode (remove
  `STRIMZI_NAMESPACE`, bind `strimzi-cluster-operator-watched`/`-namespaced`
  ClusterRoles) and the tenant `sapi-user` ClusterRole was extended with the
  Kafka and Redis CRDs so users can create `Kafka`/`Redis` resources themselves.
- **Secrets are not committed.** `k8s/01-secrets.yaml` holds the registry pull
  secret and the database passwords and is git-ignored; `k8s/01-secrets.example.yaml`
  is the placeholder template. CNPG generates the app/superuser secrets itself.
- **Wire format.** Kafka values and Redis frames are binary; `kafka-console-consumer`
  prints MessagePack bytes, not JSON. To read one, capture the bytes and decode
  them on the workstation:
  ```bash
  kubectl exec -n dani drones-kafka-dual-role-0 -- /opt/kafka/bin/kafka-console-consumer.sh \
    --bootstrap-server localhost:9092 --topic drone.events --from-beginning --max-messages 1 \
    | xxd -p | tr -d '\n'
  # then, in a directory with msgpackr installed:
  bun -e 'import {Packr} from "msgpackr"; const p=new Packr({useRecords:false}); console.log(p.unpack(Buffer.from(process.argv[1],"hex")))' <hex>
  ```
- **Rebuilding after a code change** is `make release && make rollout`.
