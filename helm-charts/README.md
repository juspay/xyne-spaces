# Xyne Spaces Helm charts

**Who this is for:** engineers who run Xyne Spaces on a Kubernetes cluster they already operate,
with Helm and values files, without the automated installer.

If you want a cluster, database, cache, object storage and DNS created for you, use the automated
installer under `deployment/` instead: [deployment/README.md](../deployment/README.md). It ends up
installing exactly these charts.

Contents:

- [What the charts are](#what-the-charts-are)
- [Install on an existing cluster](#install-on-an-existing-cluster)
- [Install one service](#install-one-service)
- [Values reference](#values-reference)
- [Conventions](#conventions)
- [Versions and releases](#versions-and-releases)
- [Working on charts](#working-on-charts)

Per-chart detail (image, ports, Secrets, environment, scaling, storage, gotchas) is in
[CHARTS.md](CHARTS.md).

## What the charts are

One chart per service, all built on the `xyne-common` library chart, so every service renders the
same set of Kubernetes objects from the same values schema. The `xyne-spaces` umbrella installs
them together.

```
helm-charts/charts/
├── xyne-common/               library: every shared template lives here
├── xyne-backend/              API server (Node.js)
├── xyne-worker/               background workers (the backend image, worker entrypoint; one install per role)
├── xyne-dashboard/            web app (static bundle, nginx)
├── xyne-dashboard-external/   guest call-join web app, served under /external
├── xyne-dashboard-edge/       bundle-serving edge with routing rules
├── xyne-zero/                 Zero sync cache (view-syncer or replication-manager)
├── xyne-ysweet/               y-sweet collaboration server (Yjs)
├── xyne-claw/                 agent runtime
├── xyne-claw-auth/            agent auth and control plane
├── xyne-claw-auth-frontend/   agent auth UI, served under /claw
├── xyne-transcription-agent/  LiveKit transcription worker (Python)
├── xyne-lighton-ocr/          OCR wrapper service (Python)
├── xyne-vespa/                Vespa node, one install per role
├── xyne-vespa-embedder/       GPU text-embeddings-inference server
├── xyne-tei-batch-proxy/      batching proxy in front of the embedder
├── xyne-redis/                single-node Redis (StatefulSet)
├── xyne-sandbox-router/       HTTP/WebSocket router in front of Kata sandboxes
├── xyne-egress-proxy/         allowlist-only Squid, the sandboxes' only way out
└── xyne-spaces/               umbrella: installs the above together
```

What the charts **do not** contain, and what you bring yourself (or get from the automated
installer):

| Not in the charts | What the services expect |
|---|---|
| PostgreSQL | one Postgres 16 server with logical replication and five databases (see [Prepare dependencies](#2-prepare-dependencies)) |
| Redis | any Redis reachable from the namespace; `xyne-redis` is a single-node, single-volume chart you may use instead of a managed one |
| Object storage | S3-compatible buckets or GCS buckets |
| Kubernetes Secrets | never created by a chart; every chart references Secrets by name (see [Create the Secrets](#3-create-the-secrets)) |
| Database schema | not created by the charts and not migrated by the backend at start (see [Apply the database schema](#4-apply-the-database-schema)) |
| Vespa application package | `xyne-vespa` runs the nodes; the schemas are deployed with `vespa deploy` |
| LiveKit | the transcription agent and the backend dial out to a LiveKit server you run |
| Kata runtime, sandbox controller, SandboxTemplate | the sandbox router and the egress proxy only make sense next to that stack |
| Ingress controller, Istio, cert-manager | the charts render Ingress or Istio objects; the controllers are yours |

## Install on an existing cluster

The walkthrough installs the default umbrella set - backend, dashboard, Zero (view-syncer plus
replication-manager), y-sweet - plus one worker and the single-node Redis chart, on
`https://spaces.example.com`. Replace `spaces.example.com`, bucket names and credentials with your
own.

### 1. Prerequisites

- **Kubernetes 1.27 or newer.** The charts use `autoscaling/v2` (1.23+), `policy/v1` (1.21+),
  `networking.k8s.io/v1` Ingress, and the StatefulSet charts (`xyne-redis`, `xyne-vespa`) set
  `persistentVolumeClaimRetentionPolicy`, which is on by default from 1.27.
- **Helm 3.14 or newer.** The release pipeline packages the charts with Helm 3.16; they also render
  with Helm 4.
- **`kubectl`** with access to the cluster, and a namespace to install into (the examples use
  `xyne`).
- **One of an Ingress controller or Istio** to expose the services, and a TLS certificate for the
  domain (cert-manager is optional; any Secret of type `kubernetes.io/tls` works).
- **A default StorageClass** if you enable `persistence` (the walkthrough does, for the
  replication-manager, y-sweet and Redis).
- An OAuth client for sign-in: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or
  `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`. The redirect URI is
  `https://spaces.example.com/api/auth/exchange`.

### 2. Prepare dependencies

**PostgreSQL 16.** One server, `wal_level = logical` (Zero replicates through a logical
replication slot), `max_replication_slots` and `max_wal_senders` at least 20, and a role that owns
the databases and has `REPLICATION`. As SQL, this is what the automated installer's Postgres ends
up with:

```sql
CREATE ROLE xyne LOGIN PASSWORD '<password>';
CREATE DATABASE xyne OWNER xyne;
CREATE DATABASE xyne_common OWNER xyne;
CREATE DATABASE zero_cvr OWNER xyne;
CREATE DATABASE zero_cdb OWNER xyne;
CREATE DATABASE claw_auth OWNER xyne;
ALTER ROLE xyne REPLICATION;
ALTER SYSTEM SET wal_level = logical;
ALTER SYSTEM SET max_replication_slots = 20;
ALTER SYSTEM SET max_wal_senders = 20;
```

`wal_level` needs a server restart. `claw_auth` is only used by `xyne-claw-auth` (off by
default). If you put a connection pooler in front of Postgres, the Zero URLs (`ZERO_UPSTREAM_DB`
in both Secrets, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`) must point at the primary directly, never at the
pooler; the backend's `DATABASE_URL` and `COMMON_DATABASE_URL` may go through the pooler.

**Redis.** Any Redis 7 reachable from the namespace, with or without a password. The walkthrough
uses the `xyne-redis` chart, which reads its password from Secret `xyne-redis-auth`, key
`password`, and is reachable as `xyne-redis:6379`.

**Object storage.** S3-compatible (`STORAGE_PROVIDER: s3`), GCS (`STORAGE_PROVIDER: gcs`) or
Azure Blob (`STORAGE_PROVIDER: azure`, where a bucket is a container). The backend uses one
bucket per purpose; the variable names are historical and apply to all three providers:

| Purpose | Backend variable | Example bucket |
|---|---|---|
| chat attachments and files (the default bucket) | `S3_BUCKET_NAME` (s3), `GCS_BUCKET_NAME` (gcs) or `AZURE_STORAGE_CONTAINER` (azure) | `xyne-main` |
| documents | `GCS_DOCS_BUCKET_NAME` | `xyne-docs` |
| canvases | `GCS_CANVAS_BUCKET_NAME` | `xyne-canvas` |
| session recordings | `GCS_SESSION_RECORDING_BUCKET_NAME` | `xyne-recordings` |
| workflow steps | `GCS_WORKFLOW_STEPS_BUCKET_NAME` | `xyne-workflows` |
| transcriptions | `TRANSCRIPTION_BUCKET_NAME` | `xyne-transcription` |
| dashboard bundles (served by `xyne-dashboard-edge`) | `GCS_BUNDLE_BUCKET_NAME` | `xyne-bundles` |
| agent chat attachments (`xyne-claw-auth`) | `S3_BUCKET_NAME` / `GCS_BUCKET_NAME` / `AZURE_STORAGE_CONTAINER` on that chart | `xyne-claw` |

For S3 set `AWS_REGION`, and `S3_ENDPOINT` when the endpoint is not the provider default (an
on-premises S3-compatible store). Credentials are either static keys (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` in a Secret) or a cloud identity bound to the pod's ServiceAccount through
`serviceAccount.annotations`, in which case leave the keys out. For GCS set `GCS_PROJECT_ID` and
bind an identity; the GCS client is configured with the project and bucket only and
authenticates with the pod's application default credentials. For Azure Blob set
`AZURE_STORAGE_ACCOUNT` and bind a workload identity (the annotation on the ServiceAccount plus
the `azure.workload.identity/use: "true"` pod label); the client derives
`https://<account>.blob.core.windows.net` and signs with that identity, so no account key is
needed. `AZURE_STORAGE_ENDPOINT` overrides the derived URL (Azurite, a custom domain), and
`AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_SAS_TOKEN` replace the identity when you
must use static credentials.

### 3. Create the Secrets

The charts never create Secrets. Each Secret below is referenced by name from a chart's
`secretEnv`; create them in the release namespace before installing. Generate the random values
once and keep them: rotating `JWT_SECRET` logs everyone out, rotating `ENCRYPTION_KEY` makes
stored credentials unreadable.

```bash
kubectl create namespace xyne

JWT_SECRET="$(openssl rand -hex 32)"
ZERO_AUTH_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
INTERNAL_S2S_KEY="$(openssl rand -hex 32)"
ZERO_ADMIN_PASSWORD="$(openssl rand -hex 16)"
REDIS_PASSWORD="$(openssl rand -hex 16)"
```

`ENCRYPTION_KEY` must be exactly 32 bytes as 64 hex characters; the backend refuses to boot
otherwise. `ZERO_AUTH_SECRET` must be identical in `xyne-backend-secrets` and `xyne-zero-secrets`.
`REDIS_URL` carries the same host, port and password as `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
(`rediss://` when `REDIS_TLS` is `"true"`).

y-sweet uses a key pair: the server holds the private key, the backend presents the derived
server token. Both come from one `y-sweet gen-auth --json` run, which prints `private_key` and
`server_token`. The CLI is in the y-sweet image, which has no entrypoint, so the binary name is
part of the command:

```bash
docker run --rm ghcr.io/juspay/y-sweet:sha-221d5af y-sweet gen-auth --json
Y_SWEET_AUTH="<private_key from the output>"
Y_SWEET_SERVER_TOKEN="<server_token from the output>"
```

Now the Secrets. Postgres host, port and password are yours; `sslmode=require` matches a managed
server, use `sslmode=disable` for a server without TLS.

```bash
PG="postgresql://xyne:<password>@postgres.example.internal:5432"

kubectl -n xyne create secret generic xyne-backend-secrets \
  --from-literal=DATABASE_URL="${PG}/xyne?sslmode=require" \
  --from-literal=COMMON_DATABASE_URL="${PG}/xyne_common?sslmode=require" \
  --from-literal=ZERO_UPSTREAM_DB="${PG}/xyne?sslmode=require" \
  --from-literal=REDIS_URL="redis://:${REDIS_PASSWORD}@xyne-redis:6379" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=ZERO_AUTH_SECRET="${ZERO_AUTH_SECRET}" \
  --from-literal=ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
  --from-literal=INTERNAL_S2S_KEY="${INTERNAL_S2S_KEY}" \
  --from-literal=Y_SWEET_SERVER_TOKEN="${Y_SWEET_SERVER_TOKEN}" \
  --from-literal=AWS_ACCESS_KEY_ID="<storage access key>" \
  --from-literal=AWS_SECRET_ACCESS_KEY="<storage secret key>" \
  --from-literal=GOOGLE_CLIENT_ID="<oauth client id>" \
  --from-literal=GOOGLE_CLIENT_SECRET="<oauth client secret>"

kubectl -n xyne create secret generic xyne-zero-secrets \
  --from-literal=ZERO_UPSTREAM_DB="${PG}/xyne?sslmode=require" \
  --from-literal=ZERO_CVR_DB="${PG}/zero_cvr?sslmode=require" \
  --from-literal=ZERO_CHANGE_DB="${PG}/zero_cdb?sslmode=require" \
  --from-literal=ZERO_AUTH_SECRET="${ZERO_AUTH_SECRET}" \
  --from-literal=ZERO_ADMIN_PASSWORD="${ZERO_ADMIN_PASSWORD}"

kubectl -n xyne create secret generic xyne-ysweet-secrets \
  --from-literal=Y_SWEET_AUTH="${Y_SWEET_AUTH}" \
  --from-literal=AWS_ACCESS_KEY_ID="<storage access key>" \
  --from-literal=AWS_SECRET_ACCESS_KEY="<storage secret key>"

kubectl -n xyne create secret generic xyne-redis-auth \
  --from-literal=password="${REDIS_PASSWORD}"
```

Which keys each chart reads by default, and which you add through your values:

| Secret | Keys the chart references by default | Keys you add in values (this walkthrough) |
|---|---|---|
| `xyne-backend-secrets` (`xyne-backend`) | `DATABASE_URL`, `COMMON_DATABASE_URL`, `ZERO_UPSTREAM_DB`, `REDIS_URL`, `JWT_SECRET`, `ZERO_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_S2S_KEY` | `REDIS_PASSWORD`, `Y_SWEET_SERVER_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `xyne-backend-secrets` (`xyne-worker`) | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_S2S_KEY` | `REDIS_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-zero-secrets` | `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`, `ZERO_AUTH_SECRET`, `ZERO_ADMIN_PASSWORD` | - |
| `xyne-ysweet-secrets` | none (the chart ships `secretEnv: {}`) | `Y_SWEET_AUTH`; with an `s3://` document store also `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-redis-auth` | `password` (through `auth.existingSecret` / `auth.existingSecretKey`) | - |

Optional components have their own Secrets; create them only when you enable the chart. Keys
marked *optional* are referenced with `optional: true` and may be absent.

```bash
kubectl -n xyne create secret generic xyne-claw-secrets \
  --from-literal=XYNE_CLAW_S2S_KEY="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_S2S_KEY="${INTERNAL_S2S_KEY}" \
  --from-literal=LITELLM_API_KEY="<llm gateway key>" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}"

kubectl -n xyne create secret generic xyne-claw-auth-secrets \
  --from-literal=DATABASE_URL="${PG}/claw_auth?sslmode=require" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=XYNE_CLAW_S2S_KEY="<same value as in xyne-claw-secrets>" \
  --from-literal=INTERNAL_S2S_KEY="${INTERNAL_S2S_KEY}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=GOOGLE_CLIENT_ID="<oauth client id>" \
  --from-literal=GOOGLE_CLIENT_SECRET="<oauth client secret>"

kubectl -n xyne create secret generic xyne-transcription-agent-secrets \
  --from-literal=LIVEKIT_API_KEY="<livekit api key>" \
  --from-literal=LIVEKIT_API_SECRET="<livekit api secret>" \
  --from-literal=TRANSCRIPTION_AGENT_API_KEY="$(openssl rand -hex 32)"

kubectl -n xyne create secret generic xyne-lighton-ocr-secrets \
  --from-literal=LIGHTON_ACCESS_TOKEN="<ocr model endpoint token>" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}"
```

| Secret | Required keys | Optional keys |
|---|---|---|
| `xyne-claw-secrets` | `XYNE_CLAW_S2S_KEY`, `LITELLM_API_KEY` | `INTERNAL_S2S_KEY`, `REDIS_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-claw-auth-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY` (64 hex), `XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY` | `SPACES_DB_URL`, `REDIS_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-transcription-agent-secrets` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TRANSCRIPTION_AGENT_API_KEY` | `REDIS_PASSWORD`, `AZURE_OPENAI_STT_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_TTS_API_KEY`, `DEEPGRAM_API_KEY`, `CHUTES_STT_API_KEY`, `GOOGLE_VOICE_CREDENTIALS_JSON`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-lighton-ocr-secrets` | - | `LIGHTON_ACCESS_TOKEN`, `REDIS_PASSWORD` |

Anything else you need in a pod's environment goes through the same two keys on any chart:
`secretEnv` (one variable from one Secret key) or `envFromSecrets` (every key of a Secret).

### 4. Apply the database schema

The backend does not run migrations at start and no chart ships a migration Job. Apply the two
Prisma schemas once, before the first install, from the backend image with the same
`DATABASE_URL` and `COMMON_DATABASE_URL` the pods will use. This is the sequence the repository's
own test stack uses (`docker-compose.test.yml`):

```bash
docker run --rm \
  -e DATABASE_URL="${PG}/xyne?sslmode=require" \
  -e COMMON_DATABASE_URL="${PG}/xyne_common?sslmode=require" \
  ghcr.io/juspay/xyne-spaces-backend:<version> \
  sh -c 'pnpm exec prisma db push --skip-generate \
    && pnpm exec prisma db push --schema prisma-common/schema.prisma --accept-data-loss --skip-generate \
    && pnpm exec prisma db execute --file prisma/migrations/20251127175400_add_ticket_xyne_id_sequence/migration.sql --schema prisma/schema.prisma'
```

Run the same three commands after every upgrade whose release notes mention a schema change
(from inside a running backend pod: `kubectl -n xyne exec deployment/xyne-backend -- sh -c '...'`).
The `claw_auth` database is prepared the same way from the `xyne-spaces-claw-auth-backend` image
(`npx prisma db push`) when you enable `xyne-claw-auth`.

### 5. Write `my-values.yaml`

The full file is at [examples/umbrella-values.yaml](examples/umbrella-values.yaml); copy it and
edit. It enables the default set plus a notification worker and the single-node Redis chart,
turns on the replication-manager, gives the replication-manager, y-sweet and Redis persistent
volumes, and exposes everything through per-chart Ingress objects on one host.

```yaml
global:
  imageRegistry: ""
  imagePullSecrets: []

xyne-backend:
  enabled: true
  env:
    FRONTEND_URL: https://spaces.example.com
    BACKEND_URL: https://spaces.example.com
    CORS_ORIGIN: https://spaces.example.com
    REDIS_HOST: xyne-redis
    REDIS_PORT: "6379"
    REDIS_TLS: "false"
    STORAGE_PROVIDER: s3
    AWS_REGION: us-east-1
    S3_ENDPOINT: ""
    S3_BUCKET_NAME: xyne-main
    GCS_DOCS_BUCKET_NAME: xyne-docs
    GCS_CANVAS_BUCKET_NAME: xyne-canvas
    GCS_SESSION_RECORDING_BUCKET_NAME: xyne-recordings
    GCS_WORKFLOW_STEPS_BUCKET_NAME: xyne-workflows
    TRANSCRIPTION_BUCKET_NAME: xyne-transcription
    GCS_BUNDLE_BUCKET_NAME: xyne-bundles
  secretEnv:
    REDIS_PASSWORD:
      name: xyne-backend-secrets
      key: REDIS_PASSWORD
      optional: true
    Y_SWEET_SERVER_TOKEN:
      name: xyne-backend-secrets
      key: Y_SWEET_SERVER_TOKEN
    AWS_ACCESS_KEY_ID:
      name: xyne-backend-secrets
      key: AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY:
      name: xyne-backend-secrets
      key: AWS_SECRET_ACCESS_KEY
    GOOGLE_CLIENT_ID:
      name: xyne-backend-secrets
      key: GOOGLE_CLIENT_ID
      optional: true
    GOOGLE_CLIENT_SECRET:
      name: xyne-backend-secrets
      key: GOOGLE_CLIENT_SECRET
      optional: true
  ingress:
    enabled: true
    className: ""
    annotations: {}
    hosts:
      - host: spaces.example.com
        paths:
          - path: /api/
            pathType: Prefix
    tls:
      - secretName: spaces-example-com-tls
        hosts:
          - spaces.example.com

xyne-worker:
  enabled: true
  fullnameOverride: xyne-worker-notifications
  env:
    REDIS_HOST: xyne-redis
    REDIS_PORT: "6379"
    REDIS_TLS: "false"
    STORAGE_PROVIDER: s3
    AWS_REGION: us-east-1
    S3_ENDPOINT: ""
    S3_BUCKET_NAME: xyne-main
    GCS_DOCS_BUCKET_NAME: xyne-docs
    GCS_CANVAS_BUCKET_NAME: xyne-canvas
    GCS_SESSION_RECORDING_BUCKET_NAME: xyne-recordings
    GCS_WORKFLOW_STEPS_BUCKET_NAME: xyne-workflows
    TRANSCRIPTION_BUCKET_NAME: xyne-transcription
    GCS_BUNDLE_BUCKET_NAME: xyne-bundles
    ENABLE_NOTIFICATION_WORKER: "true"
    ENABLE_WORKFLOW_RECOVERY: "true"
  secretEnv:
    REDIS_PASSWORD:
      name: xyne-backend-secrets
      key: REDIS_PASSWORD
      optional: true
    AWS_ACCESS_KEY_ID:
      name: xyne-backend-secrets
      key: AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY:
      name: xyne-backend-secrets
      key: AWS_SECRET_ACCESS_KEY
  autoscaling:
    enabled: false
  replicaCount: 1

xyne-dashboard:
  enabled: true
  ingress:
    enabled: true
    className: ""
    annotations: {}
    hosts:
      - host: spaces.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: spaces-example-com-tls
        hosts:
          - spaces.example.com

xyne-zero:
  enabled: true
  ingress:
    enabled: true
    className: ""
    annotations: {}
    hosts:
      - host: spaces.example.com
        paths:
          - path: /zero/
            pathType: Prefix
    tls:
      - secretName: spaces-example-com-tls
        hosts:
          - spaces.example.com

xyne-zero-replication:
  enabled: true
  persistence:
    enabled: true
    storageClass: ""
    size: 50Gi

xyne-ysweet:
  enabled: true
  secretEnv:
    Y_SWEET_AUTH:
      name: xyne-ysweet-secrets
      key: Y_SWEET_AUTH
  persistence:
    enabled: true
    storageClass: ""
    size: 20Gi
  ingress:
    enabled: true
    className: ""
    annotations: {}
    hosts:
      - host: spaces.example.com
        paths:
          - path: /ysweet/
            pathType: Prefix
    tls:
      - secretName: spaces-example-com-tls
        hosts:
          - spaces.example.com

xyne-redis:
  enabled: true
  persistence:
    enabled: true
    storageClass: ""
    size: 8Gi
  auth:
    existingSecret: xyne-redis-auth
    existingSecretKey: password
```

What the file does, key by key:

- `xyne-backend.env`: `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGIN` are the public URL (the
  chart defaults are localhost placeholders). `REDIS_HOST` points at the `xyne-redis` Service.
  `STORAGE_PROVIDER` plus the bucket variables are from the table in step 2; for GCS replace
  `AWS_REGION`/`S3_ENDPOINT`/`S3_BUCKET_NAME` with `GCS_PROJECT_ID`/`GCS_BUCKET_NAME`, for Azure
  Blob with `AZURE_STORAGE_ACCOUNT`/`AZURE_STORAGE_CONTAINER`, and drop the `AWS_*` entries from
  `secretEnv`.
- `xyne-worker`: one install runs one set of roles. `fullnameOverride` gives it its own name;
  `ENABLE_NOTIFICATION_WORKER` and `ENABLE_WORKFLOW_RECOVERY` are the roles. The worker shares
  `xyne-backend-secrets` and needs the same storage and Redis settings as the backend. Search
  indexing needs a second install with `ENABLE_VESPA_WORKER: "true"` once the Vespa tier exists
  (see [CHARTS.md](CHARTS.md#xyne-worker)).
- `xyne-zero` is the view-syncer (2 replicas, HPA) and `xyne-zero-replication` is the
  replication-manager (1 replica, owns the replication slot). The umbrella already carries the
  replication-manager overrides; enabling it and giving it a volume is all that is needed. Without
  the volume the replica is rebuilt from Postgres after every restart.
- `xyne-ysweet.persistence` keeps the documents across pod restarts. The chart's default store is
  the local directory `/data`, which is why it runs one replica.
- `ingress` on four charts: `/api/` to the backend, `/zero/` to the view-syncer, `/ysweet/` to
  y-sweet, and `/` to the dashboard. Every chart's Ingress carries the same host and TLS Secret;
  the controller merges them and the longest prefix wins.
- `xyne-redis.auth` is the chart default, spelled out: the password comes from `xyne-redis-auth`.

**Routing.** The browser derives every URL from the host that serves the dashboard, so the four
prefixes must be served from one origin:

| Path prefix | Service | Port | Notes |
|---|---|---|---|
| `/api/` | `xyne-backend` | 80 | REST API, OAuth callback, Zero push/query endpoints |
| `/zero/` | `xyne-zero` | 80 | WebSockets; no idle timeout. zero-cache accepts one leading path segment, so the prefix may be forwarded as-is; the automated installer strips it (`rewrite` to `/`) |
| `/ysweet/` | `xyne-ysweet` | 8080 | WebSockets; forwarded as-is |
| `/external/` | `xyne-dashboard-external` | 80 | only with that chart enabled |
| `/claw/` | `xyne-claw-auth-frontend` | 80 | only with that chart enabled |
| `/` | `xyne-dashboard` | 80 | everything else |

With Istio instead of an Ingress controller, leave `ingress.enabled: false`, set
`istio.destinationRule.enabled: true` on each chart, and bind one VirtualService to your Gateway
with the routes above (that is what the automated installer does; a chart's own
`istio.virtualService` renders a cluster-internal VirtualService, whose default host is
`<fullname>.<namespace>.svc.cluster.local`). Give the `/zero/` and `/ysweet/` routes
`timeout: 0s`. With a Gateway `istio-ingress/xyne-gateway` serving `spaces.example.com`, this is
the whole routing object:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: xyne
  namespace: xyne
spec:
  hosts:
    - spaces.example.com
  gateways:
    - istio-ingress/xyne-gateway
  http:
    - name: api
      match:
        - uri:
            prefix: /api/
      route:
        - destination:
            host: xyne-backend
            port:
              number: 80
      timeout: 50s
    - name: zero
      match:
        - uri:
            prefix: /zero/
      rewrite:
        uri: /
      route:
        - destination:
            host: xyne-zero
            port:
              number: 80
      timeout: 0s
    - name: ysweet
      match:
        - uri:
            prefix: /ysweet/
      route:
        - destination:
            host: xyne-ysweet
            port:
              number: 8080
      timeout: 0s
    - name: dashboard
      match:
        - uri:
            prefix: /
      route:
        - destination:
            host: xyne-dashboard
            port:
              number: 80
```

### 6. Install

Pick a release. Releases are tagged `chart-<version>` in this repository
(<https://github.com/juspay/xyne-spaces/tags>) and published as chart version
`0.1.0-app.<version>` to `oci://ghcr.io/juspay/charts`; both name the same commit, and every
first-party image is tagged `<version>`. A release's umbrella can only enable the sub-charts it
carries, so check the dependency list of the version you picked and enable only those (charts
added since an earlier release are simply absent from it):

```bash
export VERSION=<version>
helm show chart oci://ghcr.io/juspay/charts/xyne-spaces --version 0.1.0-app.${VERSION} | grep -E '^  (name|alias):'
```

Install from the OCI registry:

```bash
helm install xyne oci://ghcr.io/juspay/charts/xyne-spaces \
  --version 0.1.0-app.${VERSION} \
  -n xyne --create-namespace \
  -f my-values.yaml
```

Or from the release tag. Tags carry the vendored sub-charts, so no `helm dependency update` is
needed:

```bash
git clone --depth 1 --branch chart-${VERSION} https://github.com/juspay/xyne-spaces.git
helm install xyne xyne-spaces/helm-charts/charts/xyne-spaces \
  -n xyne --create-namespace \
  -f my-values.yaml
```

Render first if you want to see what will be applied:

```bash
helm template xyne oci://ghcr.io/juspay/charts/xyne-spaces --version 0.1.0-app.${VERSION} \
  -n xyne -f my-values.yaml > rendered.yaml
```

### 7. Verify

```bash
kubectl -n xyne get pods -l app.kubernetes.io/instance=xyne
kubectl -n xyne rollout status deployment/xyne-backend
kubectl -n xyne rollout status deployment/xyne-zero-replication
kubectl -n xyne rollout status deployment/xyne-zero
```

The replication-manager takes a few minutes on first start (it builds the replica from Postgres;
its readiness probe waits 100 s before the first check). The view-syncer connects to the
replication-manager, so bring both up before judging either.

```bash
curl -fsS https://spaces.example.com/api/health
kubectl -n xyne port-forward svc/xyne-backend 3001:3001 &
curl -fsS http://localhost:3001/api/health
```

Then open `https://spaces.example.com/` and sign in with the OAuth provider you configured. A
user with no workspace is taken to organization creation (`POST /api/auth/create-org`), which
makes them the first member of the new organization and its first workspace.

### 8. Upgrade

Every release bumps every chart to `0.1.0-app.<version>` and every first-party image tag to
`<version>`. Upgrade the umbrella to the new version with the same values file:

```bash
export VERSION=<new version>
helm upgrade xyne oci://ghcr.io/juspay/charts/xyne-spaces \
  --version 0.1.0-app.${VERSION} \
  -n xyne -f my-values.yaml
```

Apply the database schema (step 4) before the upgrade when the release changes it. The backend,
dashboard and view-syncer roll with `maxUnavailable: 0`; the replication-manager and y-sweet use
`Recreate` and are briefly unavailable.

### 9. Uninstall

```bash
helm uninstall xyne -n xyne
```

Objects the charts do not own stay behind on purpose: the Secrets, the `xyne-redis` and
`xyne-vespa` volume claims (`persistentVolumeClaimRetentionPolicy` is `Retain`), and the
PersistentVolumeClaims created for Deployments (`xyne-zero-replication`, `xyne-ysweet`) go away
with the release. Delete what you no longer need:

```bash
kubectl -n xyne delete pvc -l app.kubernetes.io/instance=xyne
kubectl -n xyne delete secret xyne-backend-secrets xyne-zero-secrets xyne-ysweet-secrets xyne-redis-auth
```

## Install one service

Every chart installs on its own with the same values schema. The Secrets it references must exist
first ([CHARTS.md](CHARTS.md) lists them per chart). [examples/backend-only-values.yaml](examples/backend-only-values.yaml)
is a complete file for the backend against an existing Redis and GCS:

```bash
helm install xyne-backend oci://ghcr.io/juspay/charts/xyne-backend \
  --version 0.1.0-app.${VERSION} \
  -n xyne --create-namespace \
  -f helm-charts/examples/backend-only-values.yaml
```

The service names the charts expect from each other are fixed by `fullname = chart name`:
`xyne-backend`, `xyne-zero`, `xyne-zero-replication`, `xyne-ysweet`, `xyne-claw` and so on. A
chart installed on its own with the default name slots into an umbrella install of the rest, and
the other way round.

Layer values files to separate what changes per environment from what changes per deployment
(later files win):

```bash
helm upgrade --install xyne-backend oci://ghcr.io/juspay/charts/xyne-backend \
  --version 0.1.0-app.${VERSION} -n xyne \
  -f infra-values.yaml \
  -f deployment-values.yaml
```

To install the same chart twice in one namespace (two worker roles, four Vespa roles), give the
second install a `fullnameOverride`.

## Values reference

Every service chart takes the same top-level keys; the library dereferences all of them, so a
chart's `values.yaml` always carries the full set even when a feature is off. `workloadKind` and
`statefulset` appear only in the charts that ship as a StatefulSet (`xyne-redis`, `xyne-vespa`)
or explicitly as a Deployment (`xyne-vespa-embedder`, `xyne-tei-batch-proxy`); on the others the
workload is a Deployment.

| Key | Type | Default behaviour | Affects |
|---|---|---|---|
| `global.imageRegistry` | string | empty; when set, replaces `image.registry` on every chart of an umbrella install | container image |
| `global.imagePullSecrets` | list | empty; merged in front of `imagePullSecrets` (strings or `{name}` objects) | pod `imagePullSecrets` |
| `nameOverride` | string | chart name | `app.kubernetes.io/name` label, container name, and the default `fullname` |
| `fullnameOverride` | string | the chart name (not `<release>-<chart>`) | every object name, the `app` selector label, Service DNS name |
| `image.registry`, `image.repository`, `image.tag`, `image.digest`, `image.pullPolicy` | strings | tag defaults to `Chart.appVersion`; `digest` wins over `tag`; `pullPolicy` defaults to `IfNotPresent` | container image |
| `imagePullSecrets` | list | empty | pod `imagePullSecrets` |
| `version` | string | `image.tag`, else `Chart.appVersion`, sanitised to label characters | `app.kubernetes.io/version` and `version` labels, DestinationRule subset name |
| `versionedName` | bool | `false` | when `true`, Deployment/StatefulSet, ConfigMap, HPA and PDB are named `<fullname>-<version>` (dots in the version become dashes) and their selectors include `version`; the Service keeps selecting on `app` only |
| `workloadKind` | `Deployment` \| `StatefulSet` | `Deployment` | which workload renders; `persistence` becomes a `volumeClaimTemplate` on a StatefulSet |
| `statefulset.serviceName`, `.podManagementPolicy`, `.updateStrategy`, `.persistentVolumeClaimRetentionPolicy` | map | `serviceName` defaults to the chart's Service, `podManagementPolicy` to `OrderedReady`; the other two render only when set | StatefulSet spec |
| `replicaCount` | int | per chart | `replicas`, omitted when `autoscaling.enabled` |
| `revisionHistoryLimit` | int | 3 | workload |
| `strategy` | map | `{type: RollingUpdate}`; `rollingUpdate` renders only for that type | Deployment strategy (ignored on a StatefulSet; use `statefulset.updateStrategy`) |
| `command`, `args` | lists | empty (image defaults) | container |
| `containerPorts` | list | per chart | container `ports`, verbatim |
| `service.enabled`, `.type`, `.clusterIP`, `.sessionAffinity`, `.annotations`, `.ports` | map | `ClusterIP`; each port `{name, port, targetPort, protocol, nodePort}`, `targetPort` defaults to `port`, `nodePort` only on a `NodePort` Service; `clusterIP: None` makes it headless; `sessionAffinity` is read by the template but absent from every `values.yaml`, add it when you need it | Service |
| `env` | map | per chart | rendered into ConfigMap `<workload name>` and loaded with `envFrom`; values go through `tpl`, `null` entries are dropped; the pod annotation `checksum/config` hashes this map, so changing it rolls the pods |
| `secretEnv` | map | per chart | one `env` entry per key: `{name: <Secret>, key: <Secret key>, optional: <bool>}`, `key` defaults to the variable name |
| `envFromSecrets` | list | empty | `envFrom` `secretRef` per entry; a string is the Secret name, a map (`{name, optional}`) is passed through |
| `envFromConfigMaps` | list | empty | `envFrom` `configMapRef` per name |
| `extraEnv` | list | empty | appended to the container `env` verbatim (`valueFrom`, `fieldRef`, ...) |
| `startupProbe`, `livenessProbe`, `readinessProbe` | maps | per chart; `{}` renders no probe | container probes, verbatim |
| `lifecycle` | map | empty | container lifecycle hooks |
| `resources` | map | per chart | container resources |
| `podSecurityContext`, `securityContext` | maps | per chart | pod and container security contexts, verbatim |
| `serviceAccount.create`, `.name`, `.annotations`, `.automount` | map | created, named `<fullname>`, token not mounted (`automount: false`); with `create: false` the pod uses `serviceAccount.name` or `default` | ServiceAccount, pod `serviceAccountName` and `automountServiceAccountToken` |
| `commonLabels` | map | empty | added to every object's labels |
| `podLabels`, `podAnnotations`, `deploymentAnnotations` | maps | empty | pod template labels/annotations; workload annotations |
| `nodeSelector`, `tolerations`, `topologySpreadConstraints` | map/list | empty | pod scheduling, verbatim |
| `affinity` | map | empty | pod affinity, verbatim; overrides the preset |
| `podAntiAffinityPreset` | `soft` \| `hard` \| `""` | per chart | `preferred` (soft) or `required` (hard) pod anti-affinity on `kubernetes.io/hostname` using the selector labels |
| `priorityClassName`, `runtimeClassName`, `dnsPolicy`, `dnsConfig`, `hostAliases` | strings/maps | empty | pod spec fields, rendered only when set |
| `terminationGracePeriodSeconds` | int | 30 | pod |
| `initContainers`, `sidecars` | lists | empty | prepended init containers / appended containers; both go through `tpl` |
| `volumes`, `volumeMounts` | lists | per chart | pod volumes (through `tpl`) and container mounts; an entry whose `mountPath` equals `persistence.mountPath` is dropped while `persistence.enabled` is true, so a chart's default emptyDir is replaced by the claim |
| `persistence.enabled`, `.existingClaim`, `.storageClass`, `.accessModes`, `.size`, `.mountPath`, `.subPath`, `.annotations` | map | off; `accessModes` defaults to `ReadWriteOnce` | on a Deployment a PersistentVolumeClaim named `<fullname>` (or the `existingClaim`) mounted at `mountPath` as volume `data`; on a StatefulSet a `volumeClaimTemplate` named `data` |
| `autoscaling.enabled`, `.minReplicas`, `.maxReplicas`, `.targetCPUUtilizationPercentage`, `.targetMemoryUtilizationPercentage`, `.metrics`, `.behavior` | map | per chart; a target of `0` or `""` omits that metric; `metrics` is appended verbatim | HorizontalPodAutoscaler (`autoscaling/v2`) |
| `pdb.enabled`, `.minAvailable`, `.maxUnavailable`, `.unhealthyPodEvictionPolicy` | map | per chart; `maxUnavailable` wins when set, else `minAvailable` (default 1) | PodDisruptionBudget (`policy/v1`) |
| `ingress.enabled`, `.className`, `.annotations`, `.hosts`, `.tls` | map | off | Ingress named `<fullname>`; each host has `paths[]` of `{path, pathType, servicePort, servicePortName}`; `pathType` defaults to `Prefix`, the backend port to the first Service port |
| `istio.virtualService.enabled`, `.hosts`, `.gateways`, `.timeout`, `.retries`, `.http` | map | off; `hosts` defaults to `<fullname>.<namespace>.svc.cluster.local` | VirtualService `<fullname>-internal-vs`; without `http` one route to the Service (to the version subset when the DestinationRule is on) with `timeout` and `retries`; `http` replaces the route list (through `tpl`) |
| `istio.destinationRule.enabled`, `.exportTo`, `.trafficPolicy`, `.subsets` | map | off; `subsets` defaults to one subset per `version` | DestinationRule `<fullname>-destinations` |
| `networkPolicy.enabled`, `.policyTypes`, `.ingress`, `.egress` | map | off; `policyTypes` defaults to `[Ingress]` | NetworkPolicy `<fullname>` selecting the chart's pods; rules verbatim |
| `serviceMonitor.enabled`, `.namespace`, `.labels`, `.port`, `.path`, `.interval`, `.scrapeTimeout` | map | off; `namespace` defaults to the release namespace, `path` to `/metrics`, `interval` to `30s` | ServiceMonitor `<fullname>` (`monitoring.coreos.com/v1`) |
| `extraObjects` | list | empty | any extra manifests, each a YAML map or a string, rendered through `tpl` |

Chart-specific keys (`rules` on `xyne-dashboard-edge`, `rbac` on `xyne-claw`, `squid` on
`xyne-egress-proxy`, `auth` on `xyne-redis`) are described in [CHARTS.md](CHARTS.md).

Labels: every object carries `app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app`
(= fullname), `app.kubernetes.io/version`, `app.kubernetes.io/part-of: xyne-spaces`,
`app.kubernetes.io/managed-by` and `helm.sh/chart`. Services and NetworkPolicies select on the
first three; pods additionally carry `version`.

## Conventions

- **Secrets are never created by the charts.** Reference them by name through `secretEnv` (single
  keys) or `envFromSecrets` (whole Secrets). Create them with `kubectl`, an external secrets
  operator, sealed secrets - your choice.
- **`fullname` defaults to the chart name**, not `<release>-<chart>`, so in-cluster URLs such as
  `http://xyne-backend` hold whatever the release is called. Under the umbrella an aliased
  sub-chart (`xyne-zero-replication`, `xyne-vespa-content`, ...) takes the alias as its name.
  Install a chart twice in one namespace by giving the second install a `fullnameOverride`.
- **Versioned workloads.** `versionedName: true` names the Deployment, ConfigMap, HPA and PDB
  `<name>-<version>` and adds `version` to their selectors, while the Service keeps selecting on
  `app` only. Pods always carry `app` and `version` labels, and the DestinationRule publishes one
  subset per version, which is what Istio traffic splitting keys off. Keep it `false` on
  StatefulSets: renaming the workload orphans its volumes.
- **PDBs on single-replica workloads block node drains.** Charts that default to one replica ship
  with `pdb.enabled: false` or `pdb.maxUnavailable: 1`; keep that relation when you change
  `replicaCount`.
- **`workloadKind`** is `Deployment` (default) or `StatefulSet`. On a StatefulSet the
  `statefulset` block adds `serviceName`, `podManagementPolicy`, `updateStrategy` and
  `persistentVolumeClaimRetentionPolicy`, and `persistence` renders a `volumeClaimTemplate` named
  `data` (claims are named `data-<workload>-<ordinal>`) instead of a standalone claim - same
  `mountPath`, same `existingClaim` escape hatch. `serviceName` defaults to the chart's own
  Service; set `service.clusterIP: None` on charts whose clients need per-pod DNS.
- **Image references** are `image.registry` / `image.repository` / `image.tag` or `image.digest`.
  The tag defaults to the chart's `appVersion`, which a release sets to the app version on every
  chart whose image is built from this repository (`ci/images.json`). Third-party images
  (`xyne-zero`, `xyne-ysweet`, `xyne-redis`, `xyne-vespa`, `xyne-vespa-embedder`,
  `xyne-egress-proxy`, `xyne-tei-batch-proxy`) keep their own `appVersion`; `xyne-vespa` and
  `xyne-tei-batch-proxy` ship `0.0.0` and need `image.tag` set.
- **Values files carry no comments**; what needs explaining is in this file and in
  [CHARTS.md](CHARTS.md).

## Versions and releases

Two numbers:

- **Chart `version` on `main`** is `0.1.0` and is maintained by hand. Bump it when templates or
  defaults change.
- **Release versions** exist only on the `deployments` branch and its tags. A release stamps every
  chart as `<main version>-app.<app version>` (for example `0.1.0-app.1.361.0`), sets
  `appVersion` to the app version on the charts whose image is built here and on the umbrella,
  syncs the umbrella's dependency versions, vendors the sub-charts, tags the commit
  **`chart-<app version>`**, and pushes every chart to `oci://ghcr.io/juspay/charts/<chart>`.

The flow (`ci/` and `.github/workflows/`):

1. **Publish Images** (`publish-images.yml`) - run by someone on the `IMAGE_BUILDERS` allow-list,
   on a `vX.Y.Z` tag. Builds every image in `ci/images.json` and pushes
   `ghcr.io/juspay/<image>:X.Y.Z` and `:sha-<commit>`.
2. **Sync Chart Version** (`sync-chart-version.yml`) - called by step 1, or run on its own.
   Checks that every image for that version exists, merges `main` into `deployments`, runs
   `ci/scripts/bump-chart.sh X.Y.Z origin/main`, runs `helm dependency update` on every chart,
   lints, commits, tags `chart-X.Y.Z`, pushes, and pushes the packaged charts to
   `oci://ghcr.io/juspay/charts`. It refuses to run if an image is missing or the tag already
   exists.

Images built from this repository and the charts that use them:

| Image (`ghcr.io/juspay/...`) | Built from | Charts |
|---|---|---|
| `xyne-spaces-backend` | `apps/backend/Dockerfile` | `xyne-backend`, `xyne-worker` |
| `xyne-spaces-dashboard` | `apps/dashboard/Dockerfile` | `xyne-dashboard` |
| `xyne-spaces-dashboard-external` | `apps/dashboard-external/Dockerfile` | `xyne-dashboard-external` |
| `xyne-spaces-dashboard-edge` | `apps/dashboard-edge/Dockerfile` | `xyne-dashboard-edge` |
| `xyne-spaces-claw` | `apps/xyne-claw/Dockerfile` | `xyne-claw` |
| `xyne-spaces-claw-auth-backend` | `apps/xyne-claw-auth/backend/Dockerfile` | `xyne-claw-auth` |
| `xyne-spaces-claw-auth-frontend` | `apps/xyne-claw-auth/frontend/Dockerfile` | `xyne-claw-auth-frontend` |
| `xyne-spaces-transcription-agent` | `apps/backend/python-agent/Dockerfile` | `xyne-transcription-agent` |
| `xyne-spaces-lighton-ocr-server` | `lighton-ocr-server/Dockerfile` | `xyne-lighton-ocr` |
| `xyne-spaces-sandbox-router` | `claw-deployments/kata-infra/sandbox-router-ws/Dockerfile` | `xyne-sandbox-router` |

## Working on charts

```bash
bash ci/scripts/lint-charts.sh                  # dependency update, lint and render every chart, defaults and all features
bash ci/scripts/lint-charts.sh xyne-backend     # just one
OUT_DIR=/tmp/rendered bash ci/scripts/lint-charts.sh   # keep the rendered YAML
bash ci/scripts/bump-chart.sh <version>         # what a release does to Chart.yaml (needs yq, jq)
```

`lint-charts.sh` renders each service chart with its defaults and with
`ci/helm/all-features-values.yaml` (every optional object on), and the umbrella with
`ci/helm/umbrella-values.yaml` (every sub-chart on). The two files under `examples/` render the
same way:

```bash
helm dependency update helm-charts/charts/xyne-spaces
helm template x helm-charts/charts/xyne-spaces -f helm-charts/examples/umbrella-values.yaml
helm dependency update helm-charts/charts/xyne-backend
helm template x helm-charts/charts/xyne-backend -f helm-charts/examples/backend-only-values.yaml
```

A chart's `templates/all.yaml` is the single line `{{- include "xyne-common.all" . }}`; the object
set is defined once in `xyne-common/templates/`. Service-specific objects (the edge rules
ConfigMap, the claw RBAC, the Squid ConfigMap) sit next to it as ordinary templates.

Adding a service: copy an existing chart directory, change `Chart.yaml` and `values.yaml`, keep
`templates/all.yaml`, add it to `xyne-spaces/Chart.yaml` (with a `condition`),
`xyne-spaces/values.yaml` (`enabled: false` unless it belongs to the default set) and
`ci/helm/umbrella-values.yaml`, and - if its image is built here - to `ci/images.json` so releases
stamp its `appVersion`. Keep the full top-level key set in `values.yaml` even when a feature is
off, and add a section to [CHARTS.md](CHARTS.md).
