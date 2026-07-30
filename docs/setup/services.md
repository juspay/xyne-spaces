# Services

Infrastructure containers defined in `docker-compose.dev.yml` and started by
`pnpm run services`.

## Ports

| Service | Host port | Purpose |
| ------- | --------- | ------- |
| `postgres` | 5433 | Application database (Prisma `schema.prisma`) |
| `common-postgres` | 5434 | Shared reference data (`prisma-common`) |
| `claw-auth-postgres` | 5435 | Credential store for `claw-auth` |
| `redis` | 6379 | Cache, BullMQ job queues, pub/sub |
| `zero-cache` | 4848, 4849 | Zero sync server — reactive queries for the dashboard |
| `ysweet` | 8080 | Y-Sweet CRDT server — realtime document state |
| `livekit` | 7880–7882 | WebRTC SFU for voice and huddles |
| `livekit-egress` | — | Recording and stream egress |
| `minio` | 9000, 9001 | S3-compatible object storage (9001 is the console) |
| `fake-gcs` | 4443 | Google Cloud Storage emulator |
| `transcription-agent` | 8001 | Python speech-to-text worker |
| `superposition` | 9999 | Feature flags and config |
| `otel-collector` | 4317, 4318, 8888 | OpenTelemetry traces and metrics |
| `victoriametrics` | 8428 | Metrics storage |
| `grafana` | 3333 | Dashboards |

Application ports, for reference: **backend 3001**, **dashboard 5173**.

> Postgres is on **5433**, not the default 5432, so it does not collide with a
> system Postgres. The two extra Postgres instances follow on 5434 and 5435.

## Common operations

```bash
pnpm run services         # start everything and wait for health checks
pnpm run services:stop    # stop and remove containers
pnpm run cleanup          # reclaim disk (volumes, build caches)
```

Targeting one service:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
docker compose -f docker-compose.dev.yml logs -f zero-cache
docker compose -f docker-compose.dev.yml restart ysweet
docker compose -f docker-compose.dev.yml ps
```

## Compose files

| File | Use |
| ---- | --- |
| `docker-compose.dev.yml` | Local development — the default |
| `docker-compose.test.yml` | E2E test stack, layered over the dev file |
| `docker-compose.sandbox.yml` | Shared infra for multi-sandbox agent environments |

The test stack composes on top of the dev file rather than replacing it:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.test.yml up -d
```

## Vespa

Vespa powers search and is **not** part of `pnpm run services` — it is heavier and
optional for most work:

```bash
pnpm run services:vespa
```

## Sandboxes

`xyne-claw` can run agents in isolated per-agent environments, each with its own
backend and dashboard:

```bash
pnpm run sandbox -- create agent-1
pnpm run sandbox -- list
pnpm run sandbox -- logs agent-1 backend
pnpm run sandbox -- destroy agent-1
```

Shared infrastructure for these comes from `docker-compose.sandbox.yml`; per-sandbox
services are built from `docker/Dockerfile.backend.dev` and
`docker/Dockerfile.dashboard.dev`.
