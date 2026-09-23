# Chart reference

One section per chart, same structure everywhere: what it runs, the image, ports, health,
Secrets, environment, scaling and disruption, storage, security, what it talks to, chart-specific
values, and the things that bite. The shared values schema is in [README.md](README.md#values-reference);
this file only lists what a chart sets differently from that schema's defaults and what the
service needs from you.

"Release-stamped" under *Image* means the tag is the app version of the release you install
(`appVersion` on `main` is a placeholder that every release overwrites); "third party" means the
chart pins an upstream image and its `appVersion` is that image's tag.

Charts:

- [xyne-backend](#xyne-backend)
- [xyne-worker](#xyne-worker)
- [xyne-dashboard](#xyne-dashboard)
- [xyne-dashboard-external](#xyne-dashboard-external)
- [xyne-dashboard-edge](#xyne-dashboard-edge)
- [xyne-zero](#xyne-zero)
- [xyne-ysweet](#xyne-ysweet)
- [xyne-claw](#xyne-claw)
- [xyne-claw-auth](#xyne-claw-auth)
- [xyne-claw-auth-frontend](#xyne-claw-auth-frontend)
- [xyne-transcription-agent](#xyne-transcription-agent)
- [xyne-lighton-ocr](#xyne-lighton-ocr)
- [xyne-vespa](#xyne-vespa)
- [xyne-vespa-embedder](#xyne-vespa-embedder)
- [xyne-tei-batch-proxy](#xyne-tei-batch-proxy)
- [xyne-redis](#xyne-redis)
- [xyne-sandbox-router](#xyne-sandbox-router)
- [xyne-egress-proxy](#xyne-egress-proxy)
- [xyne-spaces (umbrella)](#xyne-spaces-umbrella)

## xyne-backend

The API server: REST API under `/api`, OAuth sign-in, the Zero push/query endpoints
(`/api/zero/push`, `/api/zero/query`), file uploads to object storage, and the producers for every
background queue.

**Image.** `ghcr.io/juspay/xyne-spaces-backend`, release-stamped, built from
`apps/backend/Dockerfile` (`ci/images.json`). The image runs as user `backend`, uid 1001.

**Ports.** Container `http` 3001. Service `http` 80 -> 3001 and `http-app` 3001 -> 3001, so both
`http://xyne-backend` and `http://xyne-backend:3001` work in-cluster.

**Health.** Liveness and readiness `GET /api/health` on 3001; initial delay 60 s / 30 s, period
10 s, timeout 3 s, three failures. No startup probe.

**Secrets.** `xyne-backend-secrets`, referenced through `secretEnv`:

| Key | Meaning |
|---|---|
| `DATABASE_URL` | application database (`xyne`); may go through a pooler |
| `COMMON_DATABASE_URL` | shared-state database (`xyne_common`); the schema lives in the `common` Postgres schema |
| `ZERO_UPSTREAM_DB` | application database again, on the primary directly (the Zero endpoints open their own pool) |
| `REDIS_URL` | `redis://[:password@]host:port` |
| `JWT_SECRET` | signs session tokens; rotating it logs everyone out |
| `ZERO_AUTH_SECRET` | same value as in `xyne-zero-secrets` |
| `ENCRYPTION_KEY` | 32 bytes as 64 hex characters; the process refuses to boot with anything else |
| `INTERNAL_S2S_KEY` | shared key for service-to-service calls (`xyne-claw-auth`, `xyne-claw`) |

Keys you add through `secretEnv` when you use them: `REDIS_PASSWORD`, `Y_SWEET_SERVER_TOKEN`
(without it every canvas connection fails with 401; the backend logs a warning at boot),
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`, `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`,
`DATABASE_READ_REPLICA_POOL_URL`.

**Environment** (`env`, rendered into a ConfigMap; meanings from `apps/backend/src/config/env.ts`):

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `production` | outside `development` the Zero endpoints' Postgres pool (`ZERO_UPSTREAM_DB`) uses TLS with `rejectUnauthorized: false` |
| `HOST`, `PORT` | `0.0.0.0`, `"3001"` | listen address |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `FRONTEND_URL` | `http://localhost:8080` | public URL of the dashboard; its origin is always accepted for CORS and WebSockets |
| `BACKEND_URL` | `http://localhost:3001` | public URL of the API; the OAuth redirect URI is `<BACKEND_URL>/api/auth/exchange` |
| `CORS_ORIGIN` | `http://localhost:8080` | comma-separated allowed origins |
| `REDIS_HOST`, `REDIS_PORT` | `redis`, `"6379"` | Redis for queues, caches and pub/sub; add `REDIS_TLS: "true"` for TLS |
| `Y_SWEET_URL` | `http://xyne-ysweet:8080` | y-sweet server |
| `ZERO_MUTATE_URL`, `ZERO_QUERY_URL` | `http://xyne-backend/api/zero/push`, `.../query` | where zero-cache forwards mutations and custom queries: this chart's own Service |
| `VESPA_FEED_URL`, `VESPA_QUERY_URL` | `http://vespa-feed:8080`, `http://vespa-search:8080` | the two Vespa container clusters (`xyne-vespa` roles) |
| `STORAGE_PROVIDER` | `s3` | `s3`, `gcs` or `azure` (`local` is accepted by the validator and writes to the pod filesystem) |
| `ENABLE_OTEL_METRICS` | `"false"` | the app default is `true` with `OTEL_BASE_URL=http://localhost:4318`; set `OTEL_BASE_URL` before turning it on |

Set all three public URLs. Add the bucket variables for your provider (see
[README.md](README.md#2-prepare-dependencies)); `S3_ENDPOINT` and `AWS_REGION` for S3,
`GCS_PROJECT_ID` for GCS, `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_CONTAINER` for Azure Blob
(`AZURE_STORAGE_ENDPOINT`, `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_SAS_TOKEN` are
the optional overrides). `SESSION_EXPIRY_DAYS` (180) and `API_PATH_PREFIX` (empty; an extra
prefix the API also answers on) are the other switches you are likely to touch.

**Scaling and disruption.** 2 replicas, HPA 2-6 on 70 % CPU / 80 % memory (scale up by 4 pods or
100 % every 15 s, scale down 5 % every 120 s), PDB `minAvailable: 1`, `RollingUpdate` with
`maxSurge: 25%` / `maxUnavailable: 0`. Requests 1 CPU / 3 GiB, limit 8 GiB.
`terminationGracePeriodSeconds: 60`, soft anti-affinity.

**Storage.** An emptyDir `logs` at `/repo/apps/backend/logs`. `persistence` is off (10 GiB at
`/data` if you enable it; nothing in the app needs it).

**Security.** `runAsNonRoot`, uid 1001, `fsGroup: 1001`, all capabilities dropped,
`RuntimeDefault` seccomp, no privilege escalation. ServiceAccount created, token not mounted; add
`serviceAccount.annotations` to bind a cloud identity for object storage.

**Talks to.** Postgres, Redis, object storage, `xyne-ysweet`, `vespa-feed` / `vespa-search`,
and - when enabled - `xyne-claw` (`XYNE_CLAW_URL=http://xyne-claw:8081`), `xyne-claw-auth`
(`XYNE_CLAW_AUTH_URL=http://xyne-claw-auth:3003`), `xyne-lighton-ocr`
(`DOCLING_SERVICE_URL=http://xyne-lighton-ocr:80`) and a LiveKit server (`LIVEKIT_URL`).

**Networking defaults.** Ingress host `spaces.example.com`, path `/api/`; Istio VirtualService
timeout 50 s; ServiceMonitor port `http`, path `/metrics`.

**Gotchas.**

- Do not set `VESPA_BASE_HOST`: the backend does not read it, and the value it used to carry in
  older deployments pointed at an address that resolves to nothing.
- `LIVEKIT_API_KEY=devkey` / `LIVEKIT_API_SECRET=devsecret` (the published development pair) are
  rejected by the validator; leave both empty when you have no LiveKit.
- The image is also the worker image; see [xyne-worker](#xyne-worker). Do not enable
  `ENABLE_*_WORKER` flags on the API deployment unless you mean to run that role inside the API
  pods.

## xyne-worker

The backend codebase started with its worker entrypoint (`pnpm run start:worker`). One install
runs one set of roles; install the chart once per role.

**Image.** `ghcr.io/juspay/xyne-spaces-backend`, release-stamped; there is no separate worker
image. `command: [pnpm, run, start:worker]`.

**Ports.** Container `http` 3001 and a Service with `http` 80 and `http-app` 3001 exist for
parity only; worker mode starts no HTTP server, nothing listens.

**Health.** All probes are empty on purpose. Use an exec probe if you need one.

**Secrets.** `xyne-backend-secrets`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`,
`INTERNAL_S2S_KEY`. The last three are required because the backend's env validation is loaded
even though the worker does not serve requests. Add `REDIS_PASSWORD` and the storage keys the
same way as on the backend.

**Environment.** The same Redis, storage and Vespa settings as the backend (`REDIS_HOST=redis`,
`STORAGE_PROVIDER=s3`, `VESPA_FEED_URL`, `VESPA_QUERY_URL`, `ENABLE_OTEL_METRICS="false"`), plus
the role flags, all `"false"`:

`ENABLE_VESPA_WORKER`, `VESPA_WORKER_QUEUE_NAME` (`vespa-ingestion`), `ENABLE_VESPA_FILE_WORKER`,
`ENABLE_NOTIFICATION_WORKER`, `ENABLE_AUTOMATION_WORKER`, `ENABLE_WORKFLOWS_WORKER`,
`ENABLE_CONVERSATION_INGESTION_WORKER`, `ENABLE_DOCUMENT_INGESTION_WORKER`,
`ENABLE_DATA_SOURCE_INGESTION_WORKER`, `ENABLE_SCHEDULED_MESSAGE_WORKER`,
`ENABLE_DELAYED_MESSAGE_WORKER`, `ENABLE_EMAIL_FETCH_WORKER`, `ENABLE_EMAIL_CLASSIFICATION_WORKER`,
`ENABLE_CALENDAR_SYNC_WORKER`, `ENABLE_ACTIVITY_CLASSIFICATION_WORKER`,
`ENABLE_TICKET_CLEANUP_WORKER`, `ENABLE_CALL_VALIDATION_WORKER`, `ENABLE_WORKER_SCHEDULER`,
`ENABLE_WORKFLOW_RECOVERY`.

An install with every flag at `"false"` does nothing. Two installs with the same flags on the same
Redis process every job twice.

- `VESPA_WORKER_QUEUE_NAME`: `vespa-ingestion` | `vespa-backfill-normal` | `vespa-backfill-file`.
  The Vespa worker and the notification worker are mutually exclusive in one process (the Vespa
  worker wins).
- `ENABLE_WORKER_SCHEDULER` and `ENABLE_WORKFLOW_RECOVERY` default to `true` in the app; the chart
  pins them to `"false"`. Enable each on exactly one install. The scheduler only starts inside a
  Vespa worker (`ENABLE_VESPA_WORKER: "true"`); recovery starts on any role.
- More role flags exist in `apps/backend/src/worker.ts` (`ENABLE_GCS_POLLING_WORKER`,
  `ENABLE_PROACTIVE_NUDGE_WORKER`, `ENABLE_STITCH_WORKER`, ETA deadline, team intelligence, AI
  provisioning, drive import, social media sync, Slack migration); add them under `env` when
  needed.

The role recipe, one install per role:

```bash
helm install xyne-vespa-ingestion oci://ghcr.io/juspay/charts/xyne-worker --version 0.1.0-app.${VERSION} -n xyne \
  -f worker-common-values.yaml \
  --set fullnameOverride=xyne-vespa-ingestion \
  --set env.ENABLE_VESPA_WORKER=true \
  --set env.VESPA_WORKER_QUEUE_NAME=vespa-ingestion \
  --set env.ENABLE_WORKER_SCHEDULER=true

helm install xyne-notification-worker oci://ghcr.io/juspay/charts/xyne-worker --version 0.1.0-app.${VERSION} -n xyne \
  -f worker-common-values.yaml \
  --set fullnameOverride=xyne-external-notification-worker \
  --set env.ENABLE_NOTIFICATION_WORKER=true \
  --set env.ENABLE_WORKFLOW_RECOVERY=true
```

where `worker-common-values.yaml` holds the Redis, storage and `secretEnv` settings shared by every
role (the `xyne-worker` block of [examples/umbrella-values.yaml](examples/umbrella-values.yaml)
without the flags). Under the umbrella, `xyne-worker` covers one role; install the chart on its
own for the others.

**Scaling and disruption.** 1 replica, HPA 1-3 on CPU/memory, PDB `maxUnavailable: 1` (a
`minAvailable` PDB on one replica would block node drains), `RollingUpdate`. Requests 1 CPU /
3 GiB, limit 8 GiB. Queue consumers scale horizontally; the scheduler and recovery roles must stay
at one replica, so set `autoscaling.enabled: false` on those installs.

**Storage, security.** As the backend: emptyDir `logs`, uid 1001, capabilities dropped.

**Gotchas.** The chart's default `ingress.hosts` path is `/`; there is nothing to expose, leave
`ingress.enabled: false`.

## xyne-dashboard

The web application: a static bundle served by nginx.

**Image.** `ghcr.io/juspay/xyne-spaces-dashboard`, release-stamped, built from
`apps/dashboard/Dockerfile`.

**Ports.** Container `http` 8080; Service `http` 80 -> 8080 and `http-app` 8080 -> 8080.

**Health.** Liveness and readiness `GET /` on 8080, initial delay 10 s.

**Secrets.** None (`secretEnv: {}`).

**Environment.** `ENABLE_MIGRATION: "false"` is the only runtime variable: `"true"` makes nginx
proxy `/migration/` to the hard-coded upstream `http://migration`. Every `VITE_*` setting is baked
into the bundle at image build time; setting one in `env` has no effect - rebuild the image with
the matching build argument. The bundle derives the API and Zero URLs from the host that serves
it (`https://<host>/api`, `https://<host>/zero`).

**Scaling and disruption.** 2 replicas, HPA 2-4, PDB `minAvailable: 1`, `RollingUpdate`.
Requests 250m CPU / 250 MiB, limit 1 GiB.

**Storage.** None.

**Security.** uid 1001, capabilities dropped. `readOnlyRootFilesystem` is deliberately not set:
the image CMD writes `/etc/nginx/nginx.conf`, and nginx writes `/tmp` and `/var/cache/nginx`.

**Networking defaults.** Ingress host `spaces.example.com`, path `/`.

**Gotchas.**

- Leave `command` empty: the image CMD renders `nginx.conf` from its template and starts nginx.
- The image's nginx config proxies requests whose user agent matches `devqa-xyne-<branch>` to
  `http://xyne-backend.xyne-apps.svc.cluster.local:3001` (`/api/bundles/<branch>/...`), so that
  test-only path assumes namespace `xyne-apps`. Nothing else in the image depends on the
  namespace.

## xyne-dashboard-external

The guest call-join web application, served under `/external/`.

**Image.** `ghcr.io/juspay/xyne-spaces-dashboard-external`, release-stamped, built from
`apps/dashboard-external/Dockerfile`.

**Ports.** Container `http` 8080; Service `http` 80 and `http-app` 8080.

**Health.** Liveness and readiness `GET /external/` on 8080, initial delay 10 s.

**Secrets, environment.** None (`env: {}`, `secretEnv: {}`). `API_BASE_URL`,
`CALL_INVITE_BASE_URL` and `INTERNAL_DASHBOARD_BASE_URL` are image build arguments.

**Scaling and disruption.** 2 replicas, HPA 2-4, PDB `minAvailable: 1`. Requests 250m CPU /
250 MiB, limit 1 GiB.

**Security.** uid 1001, capabilities dropped.

**Networking defaults.** Ingress host `call.example.com`, path `/external/`.

**Gotchas.** `/` answers 301 to `/external/`, so probes and the ingress path use `/external/`.

## xyne-dashboard-edge

An nginx disk cache in front of a rule resolver that serves dashboard bundles from object storage
and routes requests to bundle lanes by rule.

**Image.** `ghcr.io/juspay/xyne-spaces-dashboard-edge`, release-stamped, built from
`apps/dashboard-edge/Dockerfile` (user `edge`; the chart runs it as uid 1001).

**Ports.** Container `http` 8080; Service `http` 80 and `http-app` 8080.

**Health.** Readiness `GET /_edge/ready` (503 until the rules are loaded and the default bundle
exists), liveness `GET /_edge/healthz`. `GET /_edge/status` reports the loaded rule set.

**Secrets.** None by default. Secret-valued storage options go through `secretEnv`:
`STORAGE_AUTH_HEADER`, `AZURE_STORAGE_SAS_TOKEN`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

**Environment.**

| Variable | Default | Meaning |
|---|---|---|
| `STORAGE_BACKEND` | `gcs` | `gcs` \| `s3` \| `azure` \| `http` |
| `STORAGE_BUCKET` | `xyne-frontend-bundles` | placeholder; required unless `STORAGE_BACKEND=http` (the backend's `GCS_BUNDLE_BUCKET_NAME`) |
| `STORAGE_ENDPOINT` | `""` | empty means the provider default; required for `http`, and for `azure` unless `AZURE_STORAGE_ACCOUNT` is set |
| `STORAGE_AUTH` | `sdk` | `sdk` (a cloud identity bound through `serviceAccount.annotations`), `none`, or `sas` |
| `CACHE_MAX_SIZE`, `CACHE_INACTIVE`, `CACHE_TTL` | `2g`, `7d`, `30d` | nginx cache sizing |
| `EDGE_RELOAD_INTERVAL` | `"5"` | seconds between re-reads of `rules.json` |
| `LOG_LEVEL` | `info` | |
| `ENABLE_OTEL_METRICS`, `OTEL_BASE_URL`, `OTEL_EXPORT_INTERVAL_MS` | `"false"`, `http://localhost:4318`, `"60000"` | metrics are pushed over OTLP; there is nothing to scrape. Off because the default endpoint is localhost |

**Scaling and disruption.** 2 replicas, HPA 2-4, PDB `minAvailable: 1`. Requests 250m CPU /
512 MiB, limit 1 GiB.

**Storage.** Two volumes: emptyDir `cache` (`sizeLimit: 3Gi`) at `/var/cache/edge`, and the
ConfigMap `<fullname>-rules` mounted read-only at `/etc/edge/rules`. The cache is per pod. Keep
`CACHE_MAX_SIZE` below the emptyDir `sizeLimit`.

**Security.** uid 1001, capabilities dropped.

**Chart-specific values.** `rules` is rendered as `rules.json` into ConfigMap `<fullname>-rules`
(template `templates/rules-configmap.yaml`) and mounted as a directory, so the app re-reads it
every `EDGE_RELOAD_INTERVAL` seconds without a restart (allow about a minute for the kubelet
sync). An invalid file is rejected and the last good set keeps serving. Rules are evaluated in
order and the last one must be the catch-all; the default:

```yaml
rules:
  rules:
    - id: default
      match:
        path_prefix: /
      lane: main
```

See `apps/dashboard-edge/rules.example.json` for the full rule syntax. Set `rules: null` (not `{}`)
to manage that ConfigMap yourself.

**Networking defaults.** Ingress host `spaces.example.com`, path `/`.

## xyne-zero

The Zero sync cache. One chart, two roles: a single **replication-manager** that owns the Postgres
replication slot and serves the change stream, and any number of **view-syncers** that serve
clients. The defaults are the view-syncer.

**Image.** `docker.io/rocicorp/zero`, third party, `appVersion` `1.9.0`.

**Ports.** Container `http` 4848; Service `http` 80 -> 4848 and `http-zero` 4848 -> 4848.

**Health.** Liveness and readiness are `tcpSocket` on `http`; readiness starts after 100 s,
liveness after 400 s, ten failures each. The delays are long because the replica file is rebuilt
from Postgres after a restart.

**Secrets.** `xyne-zero-secrets`: `ZERO_UPSTREAM_DB` (application database, primary, never a
pooler), `ZERO_CVR_DB` (`zero_cvr`), `ZERO_CHANGE_DB` (`zero_cdb`), `ZERO_AUTH_SECRET` (same value
as the backend's), `ZERO_ADMIN_PASSWORD`.

**Environment.**

| Variable | Default | Meaning |
|---|---|---|
| `ZERO_PORT` | `"4848"` | listen port |
| `ZERO_LOG_LEVEL` | `info` | |
| `ZERO_MUTATE_URL`, `ZERO_QUERY_URL` | `http://xyne-backend/api/zero/push`, `.../query` | the backend endpoints that apply mutations and run custom queries |
| `ZERO_MUTATE_FORWARD_COOKIES`, `ZERO_QUERY_FORWARD_COOKIES` | `"true"` | forward the client's cookies to those endpoints; that is how the backend authenticates them |
| `ZERO_REPLICA_FILE` | `/var/zero/replica.db` | the SQLite replica |
| `ZERO_CVR_MAX_CONNS`, `ZERO_UPSTREAM_MAX_CONNS` | `"10"` | Postgres pool sizes |
| `ZERO_NUM_SYNC_WORKERS` | `"5"` | view-syncer worker processes |
| `ZERO_CHANGE_STREAMER_URI` | `http://xyne-zero-replication:80` | where a view-syncer gets its change stream: the replication-manager's Service |

**Scaling and disruption.** 2 replicas, HPA 2-4 (scale up 1 pod/60 s, scale down 1 pod/300 s),
PDB `minAvailable: 1`, `RollingUpdate` with `maxSurge: 1` / `maxUnavailable: 0`. Requests 2 CPU /
10 GiB, limit 10 GiB. `terminationGracePeriodSeconds: 60`.

**Storage.** The replica sits on an emptyDir `replica` at `/var/zero` and is rebuilt after a
restart. `persistence.enabled` (50 GiB, same mount path) replaces the emptyDir with a claim; a
`ReadWriteOnce` claim only suits the single-replica replication-manager.

**Security.** uid 1001, `fsGroup: 1001`, capabilities dropped.

**Talks to.** Postgres (three databases), `xyne-backend`, and for view-syncers the
replication-manager.

**Networking defaults.** Ingress host `zero.spaces.example.com`, path `/`; Istio VirtualService
`timeout: 0s` because clients hold long-lived WebSockets.

**The replication-manager.** Install the same chart a second time with exactly this override. The
umbrella ships it under the alias `xyne-zero-replication`, so there it is just `enabled: true`:

```yaml
fullnameOverride: xyne-zero-replication
replicaCount: 1
strategy:
  type: Recreate
containerPorts:
  - name: http
    containerPort: 4849
    protocol: TCP
service:
  ports:
    - name: http
      port: 80
      targetPort: http
    - name: http-zero
      port: 4849
      targetPort: http
env:
  ZERO_NUM_SYNC_WORKERS: "0"
  ZERO_CHANGE_STREAMER_PORT: "4849"
  ZERO_CHANGE_STREAMER_URI: null
autoscaling:
  enabled: false
pdb:
  enabled: false
```

`ZERO_CHANGE_STREAMER_URI: null` removes the default so the process knows it is the source, not a
consumer. Give it `persistence.enabled: true` so a restart does not re-snapshot Postgres.

**Gotchas.**

- Never run two replication-managers against the same `ZERO_CHANGE_DB`.
- Single-node alternative: one install with `ZERO_CHANGE_STREAMER_URI: null`, `replicaCount: 1`,
  `strategy.type: Recreate` and autoscaling off. It serves clients and replicates in one process.
- The browser reaches the view-syncer at `https://<dashboard host>/zero`; zero-cache accepts one
  leading path segment, so the prefix may be forwarded as-is or stripped.

## xyne-ysweet

The y-sweet collaboration server (Yjs document sync) behind canvases.

**Image.** `ghcr.io/juspay/y-sweet`, third party (a fork built outside this repository),
`appVersion` `sha-221d5af`.

**Command.** `y-sweet serve --host 0.0.0.0 --port 8080 --checkpoint-freq-seconds 10 /data`. The
last argument is the document store: a local directory by default, or an `s3://bucket/prefix`
URL.

**Ports.** Container `http` 8080; Service `http` 8080 -> 8080 (no port 80).

**Health.** Liveness and readiness `GET /ready` on 8080, initial delay 30 s, ten failures.

**Secrets.** `secretEnv` is empty. Add `Y_SWEET_AUTH` (the `private_key` from
`y-sweet gen-auth --json`; the backend holds the matching `server_token` as
`Y_SWEET_SERVER_TOKEN`) and, for an `s3://` store, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
from Secret `xyne-ysweet-secrets`.

**Environment.** `Y_SWEET_OTEL_ENDPOINT` (`http://otel-collector:4318/v1/metrics`),
`Y_SWEET_OTEL_SERVICE_NAME` (`y-sweet`), `Y_SWEET_OTEL_PUSH_INTERVAL` (`"30"`). For an `s3://`
store add `AWS_REGION`, and `AWS_ENDPOINT_URL_S3` plus `AWS_S3_USE_PATH_STYLE: "true"` for a
non-default endpoint. The auth and S3 variable names are upstream y-sweet names that the automated
installer uses; nothing in this repository's code confirms them, so verify against the image if a
setting seems ignored.

**Scaling and disruption.** 1 replica, `Recreate`, autoscaling and PDB off. Requests 256m CPU /
256 MiB, limit 1 GiB. Keep it that way unless the store is shared object storage: with the local
directory every replica would hold its own documents.

**Storage.** `/data` is an emptyDir `ysweet-data`; documents are lost on reschedule. Set
`persistence.enabled: true` (10 GiB at `/data`) for anything real, or switch the last argument to
an `s3://` URL.

**Security.** Capabilities dropped and `RuntimeDefault` seccomp; no `runAsUser` /
`runAsNonRoot`, because the image uid is unknown.

**Talks to.** The backend calls it at `Y_SWEET_URL=http://xyne-ysweet:8080` and mints client
tokens for it (`POST /api/ysweet/auth`, rewriting the token URLs to `https://<dashboard
host>/ysweet/...`); the browser then connects to it through that prefix. The backend's
`/api/ysweet/validate` route exists for it, gated by `Y_SWEET_SERVER_TOKEN`.

**Networking defaults.** Ingress host `collab.spaces.example.com`, path `/`; Istio VirtualService
`timeout: 0s`.

## xyne-claw

The agent runtime: runs agent sessions, holds their working repositories, and drives sandboxes.

**Image.** `ghcr.io/juspay/xyne-spaces-claw`, release-stamped, built from
`apps/xyne-claw/Dockerfile`.

**Ports.** Container `http` 3002; Service `http` 8081 -> 3002 and `http-80` 80 -> 3002. Siblings
use `XYNE_CLAW_URL=http://xyne-claw:8081`.

**Health.** Liveness and readiness are `tcpSocket` on `http` (initial 60 s / 45 s, ten failures).
`GET /health` and `GET /healthz/ready` exist if you prefer httpGet probes.

**Secrets.** `xyne-claw-secrets`: `XYNE_CLAW_S2S_KEY` (required; refuses to boot without it),
`LITELLM_API_KEY` (required), and optional `INTERNAL_S2S_KEY`, `REDIS_PASSWORD`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

**Environment.**

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `XYNE_CLAW_PORT` | `"3002"` | listen port; must match the container port |
| `XYNE_CLAW_THINKING` | `medium` | default reasoning effort |
| `XYNE_CLAW_AUTH_URL` | `http://xyne-claw-auth:3003` | the auth service |
| `SPACES_BACKEND_URL` | `http://xyne-backend` | the API |
| `REDIS_HOST`, `REDIS_PORT` | `redis`, `"6379"` | the run queue |
| `XYNE_CLAW_DATA_DIR`, `XYNE_PGM_DATA_PATH` | `/repo/apps/xyne-claw/data`, `.../data/pgm` | session data |
| `LITELLM_URL`, `LITELLM_MODEL` | `http://litellm:4000`, `claude-sonnet-4-20250514` | the LLM gateway; the URL is a placeholder |
| `STORAGE_PROVIDER` | `s3` | attachments; `s3`, `gcs` or `azure` |
| `KATA_ROUTER_URL` | `""` | the sandbox router (`http://xyne-sandbox-router:8080`); empty means the sandbox tools fail closed |
| `KATA_NAMESPACE` | `{{ .Release.Namespace }}` | where sandboxes live; sent to the router |
| `KATA_TEMPLATE` | `kata-workspace-template` | the SandboxTemplate name |
| `DRAIN_TIMEOUT` | `"900"` | seconds to finish in-flight runs on shutdown |

**Scaling and disruption.** 1 replica, autoscaling off, PDB off (a PDB on one replica blocks node
drains), `RollingUpdate` with `maxSurge: 1` / `maxUnavailable: 1`. Requests 1 CPU / 2 GiB, limit
4 GiB. `terminationGracePeriodSeconds: 1020` = `DRAIN_TIMEOUT` (900) + 90; keep that relation if
you change `DRAIN_TIMEOUT`. In-flight runs live in one pod's memory, hence the single replica.

**Storage.** EmptyDirs `repos` at `/repos` and `claw-data` at `/repo/apps/xyne-claw/data`.
`persistence` is off; enabling it mounts a 20 GiB claim at `/repo/apps/xyne-claw/data/sessions`.

**Security.** The image starts as root and drops to `claw` (uid 1001) with `setpriv`, which needs
`CAP_SETUID` / `CAP_SETGID`: the chart sets only `allowPrivilegeEscalation: false` and
`RuntimeDefault` seccomp. Do not add `runAsNonRoot`, `runAsUser` or `capabilities.drop: [ALL]`.
`privileged` is not needed. `fsGroup: 1001`.

**Chart-specific values.** `rbac.create` (default `false`) renders ClusterRole and
ClusterRoleBinding `<fullname>-sandboxclaims` (`templates/rbac.yaml`): full access to
`sandboxclaims.extensions.agents.x-k8s.io`, read on `sandboxes.agents.x-k8s.io`. It needs the
sandbox controller's CRDs and `serviceAccount.automount: true`.

**Talks to.** `xyne-claw-auth`, `xyne-backend`, Redis, the LLM gateway, `xyne-sandbox-router`.

**Networking defaults.** Ingress host `claw.example.com`, path `/`; Istio VirtualService
`timeout: 3600s`.

## xyne-claw-auth

The agent auth and control plane: connectors, OAuth, agent configuration, run dispatch and the
BullMQ workers in front of `xyne-claw`. Everything it serves lives under `/claw`.

**Image.** `ghcr.io/juspay/xyne-spaces-claw-auth-backend`, release-stamped, built from
`apps/xyne-claw-auth/backend/Dockerfile` (user `clawauth`; the chart runs it as uid 1001).

**Ports.** Container `http` 3003; Service `http` 3003 -> 3003 and `http-80` 80 -> 3003.

**Health.** Liveness and readiness `GET /claw/health` (unauthenticated) on 3003; readiness every
5 s, five failures.

**Secrets.** `xyne-claw-auth-secrets`. Required: `DATABASE_URL` (the `claw_auth` database),
`ENCRYPTION_KEY` (32 bytes as 64 hex characters or the process refuses to boot),
`XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY`. Optional: `SPACES_DB_URL`, `REDIS_PASSWORD`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

**Environment.**

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_SERVICE_PORT` | `"3003"` | listen port |
| `AUTH_SERVICE_URL` | `http://localhost:3003` | public URL used for OAuth redirects; set it to the dashboard origin |
| `AUTH_SERVICE_INTERNAL_URL` | `http://xyne-claw-auth:3003` | in-cluster URL `xyne-claw` calls back |
| `XYNE_CLAW_URL` | `http://xyne-claw:8081` | the runtime |
| `SPACES_BACKEND_URL`, `XYNE_SPACES_CALLBACK_URL` | `http://xyne-backend`, `http://xyne-backend/api/agent/result` | the API and where run results are posted |
| `REDIS_HOST`, `REDIS_PORT` | `redis`, `"6379"` | BullMQ, SSE pub/sub, cron locks |
| `DEFAULT_AGENT_SLUG` | `digital-twin` | |
| `CLAW_ADMIN_EMAILS` | `""` | comma-separated admin users |
| `STORAGE_PROVIDER`, `S3_BUCKET_NAME`, `GCS_PROJECT_ID`, `GCS_BUCKET_NAME` | `s3`, `xyne-claw-chat-attachments`, `""`, `xyne-claw-chat-attachments` | chat attachments; with `azure` use `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_CONTAINER` |
| `RUN_RECOVERY_MAX_RETRIES`, `RUN_RECOVERY_TIMEOUT_MS`, `RUN_RECOVERY_BACKOFF_MS` | `"3"`, `"900000"`, `"30000"` | run recovery |
| `ENABLE_OTEL_METRICS`, `OTEL_SERVICE_NAME` | `"false"`, `xyne-claw-auth` | |

**Scaling and disruption.** 2 replicas, HPA 2-4 (scale up 2 pods/30 s, scale down 1 pod/120 s
after a 300 s window), PDB `minAvailable: 1`, `RollingUpdate` `maxUnavailable: 0`. Requests 500m
CPU / 1 GiB, limit 2 GiB. Safe with multiple replicas: signed session tokens, BullMQ on Redis, SSE
over Redis pub/sub, leader-locked crons.

**Storage.** None.

**Security.** `runAsNonRoot`, uid 1001, capabilities dropped.

**Talks to.** Postgres (`claw_auth`), Redis, `xyne-claw`, `xyne-backend`, object storage.

**Networking defaults.** Ingress host `spaces.example.com`, path `/claw/`; Istio VirtualService
`timeout: 3600s`.

## xyne-claw-auth-frontend

The agent auth UI, a static bundle served by nginx under `/claw/`, proxying `/claw/api/v1` to
`xyne-claw-auth`.

**Image.** `ghcr.io/juspay/xyne-spaces-claw-auth-frontend`, release-stamped, built from
`apps/xyne-claw-auth/frontend/Dockerfile`.

**Ports.** Container `http` 80; Service `http` 80 -> 80 and `http-app` 8083 -> 80.

**Health.** Liveness and readiness `tcpSocket` on `http` (initial 10 s / 5 s).

**Secrets, environment.** None.

**Scaling and disruption.** 2 replicas, HPA 2-4, PDB `minAvailable: 1`. Requests 100m CPU /
256 MiB, limit 512 MiB.

**Security.** nginx binds :80 as non-root, so `NET_BIND_SERVICE` is added and everything else
dropped. `runAsUser: 101` / `fsGroup: 101` is the `nginx` user of the image's base.

**Talks to.** `xyne-claw-auth` only.

**Networking defaults.** Ingress host `spaces.example.com`, path `/claw/`.

**Gotchas.** The image's nginx config has a hard-coded `proxy_pass http://xyne-claw-auth:3003`.
The auth backend must exist as Service `xyne-claw-auth` in the same namespace, and first: nginx
exits at start if the name does not resolve. It serves only `/claw/`.

## xyne-transcription-agent

The LiveKit agent worker that transcribes calls, plus the voice-input HTTP endpoints.

**Image.** `ghcr.io/juspay/xyne-spaces-transcription-agent`, release-stamped, built from
`apps/backend/python-agent/Dockerfile` (user `appuser`; the chart runs it as uid 1001).

**Ports.** Container `http` 8080; Service `http` 80 -> 8080 and `http-app` 8080 -> 8080. The
worker dials out to LiveKit; the only listener is the aiohttp server on 8080 (`/health`,
`/transcribe-audio`, `/embed-voice`, `/transcribe-stream`).

**Health.** Liveness and readiness `GET /health` (initial 60 s / 20 s, timeout 5 s). `/health`
shows the process is up, not that the worker registered with LiveKit.

**Secrets.** `xyne-transcription-agent-secrets`. Required: `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `TRANSCRIPTION_AGENT_API_KEY`. Optional: `REDIS_PASSWORD`,
`AZURE_OPENAI_STT_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_TTS_API_KEY`,
`DEEPGRAM_API_KEY`, `CHUTES_STT_API_KEY`, `GOOGLE_VOICE_CREDENTIALS_JSON`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`. Only the keys of the selected providers are needed.

**Environment.** `HEALTH_PORT` (`"8080"`), `LIVEKIT_URL` (`ws://livekit:7880`, a placeholder),
`LIVEKIT_TRANSCRIPTION_AGENT_NAME` (`xyne-automatic`; must match the name the backend dispatches
to), `BACKEND_URL` (`http://xyne-backend`), `REDIS_HOST` / `REDIS_PORT` / `REDIS_TLS`, the
provider selection `STT_PROVIDER` / `STT_MODEL` (`azure`) and `VOICE_INPUT_STT_MODEL` (`google`),
the per-provider settings (`AZURE_OPENAI_STT_*`, `GOOGLE_STT_*`, `DEEPGRAM_*`, `AZURE_OPENAI_*`,
`AZURE_OPENAI_TTS_*`), VAD tuning (`VAD_*`), `AI_VOICE_ENABLED_DEFAULT` (`"false"`),
`DIARIZATION_ENABLED` (`"false"`), `STORAGE_PROVIDER` (`s3`), `GCS_PROJECT_ID` and
`TRANSCRIPTION_BUCKET_NAME` (both `""`; set the bucket).

**Scaling and disruption.** 2 replicas, HPA 2-6, PDB `maxUnavailable: 1`. Scale-down is
deliberately slow (600 s window, one pod per 10 minutes) and `terminationGracePeriodSeconds` is
600: removing a worker kills the transcription it is running. Requests 1 CPU / 2 GiB, limit 4 GiB.

**Storage.** EmptyDir `transcriptions` at `/app/transcriptions`.

**Security.** uid 1001, capabilities dropped.

**Networking defaults.** Ingress host `transcription.example.com`, path `/`.

**Gotchas.** `DIARIZATION_ENABLED=true` only works with an image built with
`--build-arg DIARIZATION_ENABLED=true`.

## xyne-lighton-ocr

A CPU-only OCR wrapper: rasterises documents and calls an external LightOnOCR model endpoint.

**Image.** `ghcr.io/juspay/xyne-spaces-lighton-ocr-server`, release-stamped, built from
`lighton-ocr-server/Dockerfile`.

**Ports.** Container `http` 8000; Service `http` 80 -> 8000 and `http-app` 8000 -> 8000. The
backend reaches it as `DOCLING_SERVICE_URL=http://xyne-lighton-ocr:80`.

**Health.** Startup probe `GET /health` (period 10 s, 30 failures = 5 minutes), then liveness
every 30 s and readiness every 10 s on the same path.

**Secrets.** `xyne-lighton-ocr-secrets`, both optional: `LIGHTON_ACCESS_TOKEN`, `REDIS_PASSWORD`.

**Environment.** `LIGHTON_URL` (`""`, required: an OpenAI-compatible chat-completions endpoint),
`LIGHTON_MODEL` (`lightonai/LightOnOCR-2-1B-bbox`), `LIGHTON_*` request tuning (timeout,
concurrency, tokens, retries, image size, SSL verification, region/crop caps), `OCR_*` rendering
and async-job settings (`OCR_PDF_RENDER_DPI`, `OCR_MAX_PAGES`, `OCR_ASYNC_MAX_INFLIGHT`, the
`docling:*` Redis keys), tokenizer and chunking (`E5_TOKENIZER_PATH`, `MAX_TOKENS`,
`CHUNK_OVERLAP_TOKENS`, `IMAGE_CHUNK_MAX_TOKENS`), `REDIS_HOST` / `REDIS_PORT` / `REDIS_TLS`,
`PYTHONUNBUFFERED`, `HOME=/tmp`.

**Scaling and disruption.** 1 replica, HPA 1-4 on CPU only (`targetMemoryUtilizationPercentage`
empty), PDB `maxUnavailable: 1`. Requests 1 CPU / 2 GiB, limit 4 GiB.
`terminationGracePeriodSeconds: 120`.

**Storage.** EmptyDir `tmp` at `/tmp`. `HOME=/tmp` on that emptyDir is needed by LibreOffice
(`soffice`) for docx/pptx conversion.

**Security.** The Dockerfile sets no `USER`; the chart runs it as uid 1001 with capabilities
dropped. That is reasoned, not tested - fall back to root if conversion fails.

**Networking defaults.** Ingress host `ocr.example.com`, path `/`; Istio VirtualService
`timeout: 600s`.

**Gotchas.**

- While `LIGHTON_URL` is empty, `/health` returns 503, the pod never goes Ready and the startup
  probe restarts it after five minutes.
- No authentication: do not expose it publicly.

## xyne-vespa

A Vespa node. One chart, four roles, all running the same image: a single **configserver** (owns
the application package and the embedded ZooKeeper), one or more **content** nodes (proton /
storage), and the **feed** and **search** container clusters. The defaults are the configserver,
because every other role points at it and it must come up first.

**Image.** `vespaengine/vespa` (no registry set), third party. **`image.tag` must be set**: the
image is not built from this repository, so `appVersion` is the `0.0.0` placeholder.

**Workload.** `workloadKind: StatefulSet`, `podManagementPolicy: OrderedReady`,
`updateStrategy: RollingUpdate` (partition 0), `persistentVolumeClaimRetentionPolicy`
`Retain`/`Retain`. `revisionHistoryLimit: 10`.

**Ports.** Configserver: container `http` 19071, headless Service (`clusterIP: None`) on 19071.

**Health.** Readiness `GET /state/v1/health` on `http` (initial 60 s, period 15 s,
`failureThreshold: 20` = five minutes of startup). No liveness probe.

**Secrets, environment.** No Secrets. `VESPA_CONFIGSERVERS` is
`vespa-configserver-0.vespa-configserver.{{ .Release.Namespace }}.svc.cluster.local`: every role
reads it, and it resolves to the configserver's **pod** DNS name, which only exists because the
governing Service is headless. The value is templated, so the namespace follows the release.

**Scaling and disruption.** `replicaCount: 1`, autoscaling off, PDB off. Only ever run one
configserver and one replica of each content bucket. Hard pod anti-affinity.

**Storage.** `persistence.enabled: true`, 50 GiB at `/opt/vespa/var`, as the `data`
volumeClaimTemplate (claims are named `data-<workload>-<ordinal>`).

**Security.** `podSecurityContext` uid/gid/fsGroup 1000; no container security context.

**Talks to.** The configserver is contacted by every other role; feed and search are called by
the backend (`VESPA_FEED_URL=http://vespa-feed:8080`, `VESPA_QUERY_URL=http://vespa-search:8080`)
and the workers; search calls the embedder through `tei-batch-proxy`.

**The other three roles** are installs of this chart with a `fullnameOverride`. The umbrella ships
them under `xyne-vespa-content`, `xyne-vespa-feed` and `xyne-vespa-search` with exactly these
values; standalone, put them in a values file per role:

```yaml
fullnameOverride: vespa-content
args:
  - services
containerPorts:
  - name: http
    containerPort: 19107
    protocol: TCP
service:
  ports:
    - name: http
      port: 19107
      targetPort: http
readinessProbe: null
resources: null
persistence:
  size: 200Gi
```

```yaml
fullnameOverride: vespa-feed
args:
  - services
containerPorts:
  - name: http
    containerPort: 8080
    protocol: TCP
service:
  clusterIP: null
  ports:
    - name: http
      port: 8080
      targetPort: http
resources:
  requests:
    cpu: "1"
    memory: 8Gi
  limits:
    cpu: "3"
    memory: 8Gi
podSecurityContext: null
securityContext:
  runAsUser: 0
podAnnotations:
  sidecar.istio.io/inject: null
  traffic.sidecar.istio.io/includeInboundPorts: "8080"
  traffic.sidecar.istio.io/includeOutboundPorts: "8080,8088"
podAntiAffinityPreset: ""
persistence:
  enabled: false
```

```yaml
fullnameOverride: vespa-search
args:
  - services
containerPorts:
  - name: http
    containerPort: 8080
    protocol: TCP
service:
  clusterIP: null
  ports:
    - name: http
      port: 8080
      targetPort: http
resources:
  requests:
    cpu: "1"
    memory: 10Gi
  limits:
    cpu: "3"
    memory: 10Gi
podSecurityContext: null
podAnnotations:
  sidecar.istio.io/inject: null
  traffic.sidecar.istio.io/includeInboundPorts: "8080"
  traffic.sidecar.istio.io/includeOutboundPorts: "8080"
persistence:
  enabled: false
```

The `null`s are load-bearing: Helm merges maps, so `sidecar.istio.io/inject: null` is what removes
the configserver's sidecar opt-out, `clusterIP: null` is what turns the headless default back into
a normal VIP (feed and search are load-balanced, not addressed per pod), `readinessProbe: null`
removes the configserver's probe, and `podSecurityContext: null` lets the feed container run as
root (`securityContext.runAsUser: 0`).

Bring them up in order: `vespa-configserver`, then content, feed and search, then deploy the
application package.

**Gotchas.**

- **`versionedName` must stay `false`.** It renames the StatefulSet, which orphans the volumes.
- `persistentVolumeClaimRetentionPolicy` is `Retain`/`Retain`: deleting the release leaves the
  data. The claims are named `data-<workload>-<ordinal>`; nothing adopts volumes with other names.
- **Schemas are not deployed by this chart.** The application package reaches the configserver
  through `vespa deploy` (see `vespa-core/scripts/deploy-dev.sh`); the configserver comes up
  healthy but empty until it runs.
- **Readiness probes**: `/state/v1/health` on 19071 (configserver) and 8080 (feed, search).
  `vespa-content` ships **no** probe: 19107 is the storage node's state port and this has not been
  verified against the image; add one once you have. Running all four with no probes makes
  rolling updates blind.
- `vespa-content` ships **no resource requests**. Size it; a memory-heavy node type is the
  reference.
- Istio settings that have been run for the two container clusters, if you enable
  `istio.virtualService` / `istio.destinationRule`: feed 60 s timeout, 3 retries on
  `connect-failure,reset`, `ROUND_ROBIN`, 500 `http2MaxRequests`; search 10 s timeout, no
  retries, `LEAST_CONN`, 1000. Vespa pods themselves carry `sidecar.istio.io/inject: "false"`
  (configserver, content) or an explicit inbound/outbound port list (feed, search).

## xyne-vespa-embedder

A GPU text-embeddings-inference server backing the Vespa embed pipeline.

**Image.** `huggingface/text-embeddings-inference` (no registry set), third party, `appVersion`
`1.6`.

**Command.** `args`: `--model-id BAAI/bge-base-en-v1.5 --port 3000 --dtype float32
--max-client-batch-size 1000 --max-batch-requests 1000 --auto-truncate`. Model and batching are
process arguments, not environment. Changing the model changes the embedding dimensions, which
must match the Vespa schemas.

**Ports.** Container `http` 3000; Service `http` **80** -> 3000, because that is what
`tei-batch-proxy` and the Vespa `hugging-face-embedder` component address
(`http://vespa-embedder:80`). `fullnameOverride: vespa-embedder` is the chart default.

**Health.** Liveness (every 30 s) and readiness `GET /health`, timeout 1 s.

**Secrets.** None. **Environment.** `NVIDIA_VISIBLE_DEVICES=all`,
`NVIDIA_DRIVER_CAPABILITIES=compute,utility`.

**Scaling and disruption.** 1 replica, autoscaling off, PDB off, `RollingUpdate` with
`maxUnavailable: 25%`. `resources` requests and limits `nvidia.com/gpu: "1"` and nothing else;
tolerates `nvidia.com/gpu` `NoSchedule`. No anti-affinity preset.

**Storage.** None by default (`persistence` would be 50 GiB at `/data`; the model is downloaded on
start).

**Security.** No security context (`podSecurityContext: {}`, `securityContext: {}`).

**Gotchas.**

- GPU-only: the NVIDIA device plugin and drivers are cluster prerequisites. Add a `nodeSelector`
  for your GPU pool.
- The Istio sidecar is disabled (`sidecar.istio.io/inject: "false"`).

## xyne-tei-batch-proxy

A batching proxy that coalesces embedding requests before they reach the GPU.

**Image.** `xyne-spaces-tei-batch-proxy` with no registry and `appVersion` `0.0.0`: the source is
not in this repository, so **`image.registry`, `image.repository` and `image.tag` must be set** to
wherever you build it.

**Ports.** Container `http` 8088; Service `http` 8088 -> 8088. `fullnameOverride: tei-batch-proxy`
is the chart default.

**Health.** Liveness (initial 5 s, every 20 s) and readiness (initial 3 s) `GET /health`.

**Secrets.** None.

**Environment.** `PORT` (`"8088"`), `UPSTREAM_EMBEDDINGS_URL`
(`http://vespa-embedder:80/v1/embeddings`), `EMBEDDINGS_BATCH_SIZE` (`"512"`),
`UPSTREAM_CONCURRENCY` (`"4"`), `REQUEST_TIMEOUT_MS` (`"120000"`), `MAX_RETRIES` (`"0"`),
`RETRY_BASE_MS` (`"1000"`), `PROXY_PAYLOAD_LIMIT_BYTES` (`"200000000"`).

**Scaling and disruption.** 1 replica, autoscaling off (1-3 if enabled), PDB off,
`RollingUpdate` `maxUnavailable: 25%`. Requests 250m CPU / 1 GiB, limits 2 CPU / 4 GiB. It is
stateless and scales horizontally, but every replica adds `UPSTREAM_CONCURRENCY` (4) concurrent
streams against one GPU.

**Security.** No security context. Pod annotations restrict the Istio sidecar to port 8088
inbound and outbound.

**Gotchas.**

- Upstream defaults to `http://vespa-embedder:80/v1/embeddings`, so the embedder chart must be
  installed in the same namespace, or `UPSTREAM_EMBEDDINGS_URL` retargeted.
- `PROXY_PAYLOAD_LIMIT_BYTES` is 200 MB and `REQUEST_TIMEOUT_MS` 120 s: a full batch of 512
  documents is large and slow. `MAX_RETRIES: "0"` because a retry would re-run the whole batch on
  the GPU.

## xyne-redis

A single-node `redis-server` with append-only persistence, for queues, caches and pub/sub. Not a
cluster, not a sentinel pair.

**Image.** `docker.io/redis`, third party, `appVersion` `7.4`.

**Command.** `redis-server --requirepass $(REDIS_PASSWORD) --appendonly yes --dir /data`.
`redis-server` is configured entirely through `args`; there is no config file.

**Workload.** `workloadKind: StatefulSet`, `OrderedReady`, `RollingUpdate`,
`persistentVolumeClaimRetentionPolicy` `Retain`/`Retain`.

**Ports.** Container and Service `tcp-redis` 6379. The port is named `tcp-redis` so Istio treats
it as opaque TCP. The Service is a normal ClusterIP (`clusterIP: ""`); nothing needs per-pod DNS.

**Health.** Liveness and readiness are `tcpSocket`: `redis-cli ping` would need the password.

**Secrets.** The password is read from the Secret named by `auth.existingSecret` /
`auth.existingSecretKey` (defaults `xyne-redis-auth` / `password`). The chart never creates it.

**Environment.** None.

**Scaling and disruption.** `replicaCount: 1`, autoscaling off, PDB off. Requests 100m CPU /
256 MiB, limit 1 GiB. Keep it single-replica and `versionedName: false` (renaming the StatefulSet
orphans the volume).

**Storage.** `persistence.enabled: true`, 8 GiB at `/data`, as the `data` volumeClaimTemplate.

**Security.** `runAsUser: 999` / `runAsGroup: 999` / `fsGroup: 999` is the `redis` user of the
official image and makes the claim writable. Capabilities dropped, `runAsNonRoot`.

**Chart-specific values.** `auth.existingSecret`, `auth.existingSecretKey`. `templates/all.yaml`
copies them into `secretEnv.REDIS_PASSWORD` before the library renders, and the container args
pass `$(REDIS_PASSWORD)` to `--requirepass`. Set `auth.existingSecret: ""` to manage `secretEnv`
yourself.

**Talks to.** Nothing. Siblings connect with `REDIS_HOST=xyne-redis` (the automated installer
uses `xyne-redis.<namespace>.svc`), port 6379, and their own `REDIS_PASSWORD` entry in
`xyne-backend-secrets` (and `REDIS_URL`), which must hold the same value as `xyne-redis-auth`.

**Networking defaults.** ServiceMonitor port `tcp-redis`.

## xyne-sandbox-router

Forwards HTTP and WebSocket traffic to Kata sandbox pods, by `X-Sandbox-*` headers or the
`/claw-preview/<sandboxId>/...` path.

**Image.** `ghcr.io/juspay/xyne-spaces-sandbox-router`, release-stamped, built from
`claw-deployments/kata-infra/sandbox-router-ws/Dockerfile` (a fork of the upstream agent-sandbox
`sandbox_router.py` with WebSocket proxying added).

**Ports.** Container and Service `http` 8080. xyne-claw reaches it at
`KATA_ROUTER_URL=http://xyne-sandbox-router:8080`.

**Health.** Liveness and readiness `GET /healthz` (initial 10 s / 5 s).

**Secrets.** None.

**Environment.** `PROXY_TIMEOUT_SECONDS` (`"300"`; 180 in code) is the only variable it reads.

**Scaling and disruption.** 1 replica, HPA 1-3 on CPU/memory, PDB off, `RollingUpdate`
`maxSurge: 1`. Requests 100m CPU / 256 MiB, limit 2 GiB (connections are long-lived WebSockets).

**Storage.** None. **Security.** `runAsUser: 10001` is `appuser` from the Dockerfile;
capabilities dropped, `runAsNonRoot`.

**Talks to.** Sandbox pods, purely by DNS: each request goes to
`<X-Sandbox-ID>.<X-Sandbox-Namespace>.svc.cluster.local:<X-Sandbox-Port>` (defaults `default` and
8888). It never calls the Kubernetes API, so the chart ships no RBAC and leaves
`serviceAccount.automount: false`.

**Networking defaults.** Ingress host `sandbox.spaces.example.com`, path `/`; Istio VirtualService
`timeout: 0s`.

**Gotchas.**

- `X-Sandbox-Namespace` falls back to `default` when absent; the caller (`xyne-claw` via
  `KATA_NAMESPACE`) must send the namespace the sandboxes live in.
- The `/claw-preview/<sandboxId>/...` path mode (noVNC, no headers) has the namespace `xyne-apps`
  and port 6080 hard-coded in the source. An install in another namespace needs the image changed
  before that route works.
- The sandbox NetworkPolicy in `deployment/argocd/addons/sandbox` admits pods labelled
  `app: xyne-sandbox-router`. That label is the chart's `fullname`; keep `fullnameOverride` in
  step with the addon's `router.name`.

## xyne-egress-proxy

An allowlist-only Squid forward proxy: the sole internet path for Kata sandbox workspaces.

**Image.** `docker.io/ubuntu/squid`, third party, `appVersion` `6.6-24.04_beta` (the 24.04
channel; the binary inside is Squid 6.13). Only `_beta` and `_edge` tags are published; there is
no `_stable`.

**Ports.** Container and Service `tcp-proxy` 3128. The port is named `tcp-proxy` so that, if the
sidecar is ever enabled, Istio handles it as raw TCP.

**Health.** Liveness and readiness `tcpSocket` on `tcp-proxy`.

**Secrets, environment.** None.

**Scaling and disruption.** 2 stateless replicas, autoscaling off (2-4 if enabled), PDB
`minAvailable: 1`, `RollingUpdate` `maxSurge: 1` / `maxUnavailable: 0`. Requests 100m CPU /
128 MiB, limit 512 MiB.

**Storage.** ConfigMap `<fullname>-config` mounted with `subPath` as `/etc/squid/squid.conf` and
`/etc/squid/allow_hosts.txt`; emptyDirs at `/var/log/squid` (`cache.log`, which the image
entrypoint tails) and `/tmp` are the only writable paths. `persistence.mountPath` is
`/var/spool/squid` for an optional `cache_dir`; nothing uses it while `cache deny all` stands.

**Security.** uid 13 (`proxy`), read-only root filesystem, capabilities dropped, `runAsNonRoot`.
`pid_filename none` because `/run` is read-only; `pinger_enable off` because the ICMP helper needs
raw sockets. The entrypoint's `make-ssl-cert` step fails silently without root, which is harmless.
This exact setup has been run against the image. The Istio sidecar is off
(`sidecar.istio.io/inject: "false"`): the sandbox VMs are not in the mesh and CONNECT tunnels gain
nothing from it.

**Chart-specific values.** `squid.config` is the whole `squid.conf`; `squid.allowedHosts` becomes
`allow_hosts.txt` (`templates/configmap.yaml`). The default policy: `CONNECT` only to the
allowlist on 443 or 22, plain HTTP only to the allowlist on 80/443/22, everything else denied, no
caching, no `Via` or `X-Forwarded-For`, access log on stdout. The default allowlist covers
`.github.com`, `.githubusercontent.com`, `.githubassets.com`, `.npmjs.org`, `pypi.org`,
`files.pythonhosted.org`, `crates.io`, `index.crates.io`, `static.crates.io`, `rubygems.org`,
`.nixos.org`, `.cachix.org`, `ftp.gnu.org`, `ftpmirror.gnu.org`, `.haskell.org`,
`binaries.prisma.sh`.

**Talks to.** The internet, for the allowlist. The SandboxTemplate sets
`HTTP_PROXY`/`HTTPS_PROXY=http://xyne-egress-proxy:3128` and the sandbox NetworkPolicy allows
egress only to pods labelled `app: xyne-egress-proxy` on 3128 (plus cluster DNS). The label is the
chart's `fullname`; keep `fullnameOverride` in step with the addon's `egressProxy.name`.

**Gotchas.**

- Squid `dstdomain` rules: a leading dot matches the domain and every subdomain, no dot is an
  exact match. Never list a host that a `.parent` entry already covers: Squid 6 refuses to start
  (`FATAL: Bungled ... acl allowlist`) when the subdomain follows its parent, and drops it with a
  warning when it precedes it.
- The library's `checksum/config` pod annotation hashes `env` only, and `subPath` mounts do not
  receive ConfigMap updates, so changing `squid.config` or `squid.allowedHosts` does not roll the
  pods on its own. After the change run `kubectl rollout restart deployment/xyne-egress-proxy`, or
  bump a `podAnnotations` value in the same commit.
- The proxy has no authentication. Anything in the cluster that can reach the Service can use the
  allowlist; add a `networkPolicy` if that matters in your namespace.

## xyne-spaces (umbrella)

Installs the service charts together. Every sub-chart is a dependency with a `condition`
`<name>.enabled`; the umbrella's own `values.yaml` holds only the `enabled` flags, the
replication-manager overrides and the three Vespa role overrides. `global.imageRegistry` and
`global.imagePullSecrets` apply to every sub-chart.

| Values key | Chart | Default | Notes |
|---|---|---|---|
| `xyne-backend` | xyne-backend | on | |
| `xyne-dashboard` | xyne-dashboard | on | |
| `xyne-zero` | xyne-zero | on | the view-syncer |
| `xyne-ysweet` | xyne-ysweet | on | |
| `xyne-zero-replication` | xyne-zero (alias) | off | already carries the replication-manager values; just enable it |
| `xyne-worker` | xyne-worker | off | one role per umbrella; install the chart separately for more |
| `xyne-dashboard-external` | xyne-dashboard-external | off | |
| `xyne-dashboard-edge` | xyne-dashboard-edge | off | |
| `xyne-claw` | xyne-claw | off | |
| `xyne-claw-auth` | xyne-claw-auth | off | |
| `xyne-claw-auth-frontend` | xyne-claw-auth-frontend | off | needs `xyne-claw-auth` |
| `xyne-transcription-agent` | xyne-transcription-agent | off | needs a LiveKit server |
| `xyne-lighton-ocr` | xyne-lighton-ocr | off | |
| `xyne-vespa` | xyne-vespa | off | the configserver; needs `image.tag` |
| `xyne-vespa-content` | xyne-vespa (alias) | off | `fullnameOverride: vespa-content`; needs `image.tag` |
| `xyne-vespa-feed` | xyne-vespa (alias) | off | `fullnameOverride: vespa-feed`; needs `image.tag` |
| `xyne-vespa-search` | xyne-vespa (alias) | off | `fullnameOverride: vespa-search`; needs `image.tag` |
| `xyne-vespa-embedder` | xyne-vespa-embedder | off | GPU node required |
| `xyne-tei-batch-proxy` | xyne-tei-batch-proxy | off | needs `image.registry` / `image.repository` / `image.tag` |
| `xyne-redis` | xyne-redis | off | |
| `xyne-sandbox-router` | xyne-sandbox-router | off | only with the Kata sandbox stack |
| `xyne-egress-proxy` | xyne-egress-proxy | off | only with the Kata sandbox stack |

An aliased sub-chart takes the alias as its chart name, so `xyne-zero-replication` renders with
`fullname` `xyne-zero-replication` without an override; the Vespa aliases set `fullnameOverride`
because the backend addresses `vespa-feed` and `vespa-search`.

The Vespa tier is six entries: the configserver, the three aliases, the embedder and the batch
proxy. Bring them up before the backend needs search: `vespa-configserver` first, then the rest,
then `vespa deploy`. The sandbox router and the egress proxy only make sense with the Kata sandbox
stack from `deployment/argocd/addons/sandbox`, which is not part of the umbrella.

The umbrella has no templates of its own apart from `NOTES.txt`, so a top-level `extraObjects`
does nothing; put extra manifests under a sub-chart's key (for example
`xyne-dashboard.extraObjects`).
