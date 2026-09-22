# Per-chart notes

What you need to know before installing each chart. The shared values schema is described in
[README.md](README.md).

## xyne-backend

- Secret `xyne-backend-secrets` must hold `DATABASE_URL`, `COMMON_DATABASE_URL`,
  `ZERO_UPSTREAM_DB`, `REDIS_URL`, `JWT_SECRET`, `ZERO_AUTH_SECRET`, `ENCRYPTION_KEY`,
  `INTERNAL_S2S_KEY`.
- `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGIN` default to localhost placeholders; set them to
  the public URLs of the install.
- In-cluster names match the sibling charts: `REDIS_HOST=redis`,
  `Y_SWEET_URL=http://xyne-ysweet:8080`, `ZERO_MUTATE_URL` / `ZERO_QUERY_URL` ->
  `http://xyne-backend/api/zero/{push,query}`, `VESPA_FEED_URL=http://vespa-feed:8080` and
  `VESPA_QUERY_URL=http://vespa-search:8080`. Do **not** set `VESPA_BASE_HOST` - the sbx value
  points at an address that resolves to nothing (`deploy/sbx-export/README.md`).
- `STORAGE_PROVIDER` is `gcs` or `s3`. Health endpoint: `/api/health` on 3001.

## xyne-worker

- Runs the backend image with `command: [pnpm, run, start:worker]`; there is no separate
  public worker image.
- One install per worker role, each with its own `fullnameOverride`. The role is chosen only by
  the `ENABLE_*_WORKER` flags in `env`; all default to `"false"`, so an install does nothing
  until a role is set. Two installs with the same flags on the same Redis process every job twice.

  ```bash
  helm install xyne-vespa-ingestion charts/xyne-worker \
    --set fullnameOverride=xyne-vespa-ingestion \
    --set env.ENABLE_VESPA_WORKER=true --set env.VESPA_WORKER_QUEUE_NAME=vespa-ingestion

  helm install xyne-notification-worker charts/xyne-worker \
    --set fullnameOverride=xyne-external-notification-worker \
    --set env.ENABLE_NOTIFICATION_WORKER=true
  ```

- `VESPA_WORKER_QUEUE_NAME`: `vespa-ingestion` | `vespa-backfill-normal` | `vespa-backfill-file`.
  The Vespa worker and the notification worker are mutually exclusive in one process.
- `ENABLE_WORKER_SCHEDULER` and `ENABLE_WORKFLOW_RECOVERY` default to true in the app; the chart
  pins them to `"false"`. Enable them on exactly one install.
- More role flags exist in `apps/backend/src/worker.ts` (ETA deadline, stitch, team
  intelligence, AI provisioning, proactive nudge, drive import, social media sync, GCS polling,
  Slack migration); add them under `env` when needed.
- Shares `xyne-backend-secrets`; `JWT_SECRET`, `ENCRYPTION_KEY` and `INTERNAL_S2S_KEY` are
  required because the backend env validation is loaded.
- Probes are empty on purpose: worker mode starts no HTTP server. Use an exec probe if you need
  one. The Service on 3001 exists only for parity; nothing listens there.

## xyne-dashboard

- Every `VITE_*` setting is baked into the bundle at image build time. Setting it in `env` has
  no effect; rebuild the image with the matching build-arg.
- `ENABLE_MIGRATION` is the only runtime variable (`"true"` proxies `/migration/` to the
  hard-coded `http://migration`).
- Leave `command` empty: the image CMD renders nginx.conf and starts nginx.
- `readOnlyRootFilesystem` is not set: the CMD writes `/etc/nginx/nginx.conf`, nginx writes
  `/tmp` and `/var/cache/nginx`.
- nginx.conf proxies devqa user agents to `http://xyne-backend.xyne-apps.svc.cluster.local:3001`,
  so that path assumes namespace `xyne-apps`.

## xyne-dashboard-external

- No runtime environment. `API_BASE_URL`, `CALL_INVITE_BASE_URL` and
  `INTERNAL_DASHBOARD_BASE_URL` are image build-args.
- Served under `/external/`; `/` answers 301, so probes and the ingress use `/external/`.

## xyne-dashboard-edge

- `STORAGE_BUCKET` is required unless `STORAGE_BACKEND=http`; the default is a placeholder.
  `STORAGE_BACKEND`: `gcs | s3 | azure | http`. `STORAGE_ENDPOINT` empty means the provider
  default (required for `http`, and for azure unless `AZURE_STORAGE_ACCOUNT` is set).
- `STORAGE_AUTH`: `sdk` (bind a cloud identity through `serviceAccount.annotations`), `none`,
  or `sas`. Secret-valued options (`STORAGE_AUTH_HEADER`, `AZURE_STORAGE_SAS_TOKEN`,
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) go through `secretEnv`.
- `rules` renders `rules.json` into ConfigMap `<fullname>-rules`, mounted as a directory at
  `/etc/edge/rules`. The app re-reads it every `EDGE_RELOAD_INTERVAL` seconds, so rule changes
  need no restart (allow about a minute for the kubelet sync); an invalid file is rejected and
  the last good set keeps serving. Check with `GET /_edge/status`.
- Rules are evaluated in order and the last one must be the catch-all (`path_prefix: "/"` with
  a static lane). See `apps/dashboard-edge/rules.example.json`.
- Set `rules: null` (not `{}`) to manage that ConfigMap yourself.
- Readiness is `/_edge/ready` (503 until rules are loaded and the default bundle exists);
  liveness is `/_edge/healthz`.
- Keep `CACHE_MAX_SIZE` below the `cache` emptyDir `sizeLimit`. The cache is per pod.
- Metrics are pushed over OTLP; there is nothing to scrape. `ENABLE_OTEL_METRICS` is `"false"`
  in the chart because the default `OTEL_BASE_URL` is localhost.

## xyne-claw-auth-frontend

- The image's nginx config has a hard-coded `proxy_pass` to `http://xyne-claw-auth:3003`. The
  auth backend must exist as Service `xyne-claw-auth` in the same namespace, and first: nginx
  exits at start if the name does not resolve.
- nginx binds :80 as non-root, so `NET_BIND_SERVICE` is added and everything else dropped.
  `runAsUser: 101` is the `nginx` user of nginx:stable-alpine.
- Serves only `/claw/`; probes are tcpSocket.

## xyne-zero

One chart, two roles. Zero runs as a single replication-manager (owns the Postgres replication
slot, serves the change stream) plus any number of view-syncers (serve clients).

- The defaults are the view-syncer: port 4848, 2 replicas, HPA and PDB on, and
  `ZERO_CHANGE_STREAMER_URI=http://xyne-zero-replication:80`.
- The replication-manager install overrides exactly this:

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
      - {name: http, port: 80, targetPort: http}
      - {name: http-zero, port: 4849, targetPort: http}
  env:
    ZERO_NUM_SYNC_WORKERS: "0"
    ZERO_CHANGE_STREAMER_PORT: "4849"
    ZERO_CHANGE_STREAMER_URI: null
  autoscaling:
    enabled: false
  pdb:
    enabled: false
  ```

  The umbrella chart ships these values under `xyne-zero-replication`.
- Never run two replication-managers against the same `ZERO_CHANGE_DB`.
- Single-node alternative: one install with `ZERO_CHANGE_STREAMER_URI: null`, `replicaCount: 1`
  and autoscaling off.
- Secret `xyne-zero-secrets`: `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`,
  `ZERO_AUTH_SECRET` (same value as the backend's), `ZERO_ADMIN_PASSWORD`.
- The replica file sits on an emptyDir and is rebuilt after a restart, hence the long probe
  delays. `persistence.enabled` moves it to a PVC; a ReadWriteOnce claim only suits the
  single-replica replication-manager.
- `istio.virtualService.timeout: 0s` because clients hold long-lived WebSockets.

## xyne-ysweet

- The default store is the local directory `/data` (the last arg), so every replica would hold
  its own documents: keep `replicaCount: 1`, `strategy: Recreate`, autoscaling and PDB off,
  unless the last arg is switched to shared object storage (an `s3://` URL).
- `/data` is an emptyDir; documents are lost on reschedule. Set `persistence.enabled=true` for
  anything real.
- `secretEnv` is empty. The auth and S3 variable names are upstream y-sweet names that nothing
  in this repo confirms (`Y_SWEET_AUTH`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `AWS_ENDPOINT_URL_S3`, `AWS_S3_USE_PATH_STYLE`); verify against the image.
- The image uid is unknown, so no `runAsUser` / `runAsNonRoot` is set.
- The backend reaches it at `Y_SWEET_URL=http://xyne-ysweet:8080`.

## xyne-claw

- The image starts as root and drops to `claw` (uid 1001) with `setpriv`, which needs
  `CAP_SETUID` / `CAP_SETGID`: do not set `runAsNonRoot`, `runAsUser` or `capabilities.drop: [ALL]`.
  `privileged` is not needed.
- `rbac.create=true` renders the ClusterRole/Binding `<fullname>-sandboxclaims` (SandboxClaims,
  read on Sandboxes). It needs the agent-sandbox CRDs and `serviceAccount.automount: true`.
- `terminationGracePeriodSeconds: 1020` = `DRAIN_TIMEOUT` (900) + 90. Keep that relation if you
  change `DRAIN_TIMEOUT`.
- Required: `XYNE_CLAW_S2S_KEY` (refuses to boot without it), `REDIS_HOST` (run queue),
  `KATA_ROUTER_URL` for the sandbox tools (e.g. `http://sandbox-router-svc:8080`; empty means
  they fail closed). `LITELLM_URL` is a placeholder.
- Container port 3002 must match `XYNE_CLAW_PORT`; the Service exposes 8081 because siblings use
  `XYNE_CLAW_URL=http://xyne-claw:8081`.
- In-flight runs live in one pod's memory: single replica, autoscaling off, PDB off (a PDB on
  one replica blocks node drains).
- `GET /health` and `GET /healthz/ready` exist if you prefer httpGet probes.

## xyne-claw-auth

- Everything lives under `/claw`; the probe is the unauthenticated `GET /claw/health`.
- Safe with multiple replicas: signed session tokens, BullMQ on Redis, SSE over Redis pub/sub,
  leader-locked crons.
- `ENCRYPTION_KEY` must be 32 bytes as 64 hex characters or the process refuses to boot.
  `DATABASE_URL`, `XYNE_CLAW_S2S_KEY` and `INTERNAL_S2S_KEY` are required too.
- `AUTH_SERVICE_URL` is the public URL used for OAuth redirects (default is localhost - set it);
  `AUTH_SERVICE_INTERNAL_URL` is the in-cluster URL xyne-claw calls back.

## xyne-transcription-agent

- `DIARIZATION_ENABLED=true` only works with an image built with
  `--build-arg DIARIZATION_ENABLED=true`.
- Scale-down is deliberately slow (600s window, one pod per 10 minutes) and
  `terminationGracePeriodSeconds` is 600: removing a worker kills the transcription it is running.
- `LIVEKIT_URL` is a placeholder. `LIVEKIT_TRANSCRIPTION_AGENT_NAME` must match the name the
  backend dispatches to. Only the keys of the selected STT/LLM/TTS providers are needed.
- The worker dials out to LiveKit; the only listener is aiohttp on 8080 (`/health`,
  `/transcribe-audio`, `/embed-voice`, `/transcribe-stream`). `/health` shows the process is up,
  not that the worker registered.

## xyne-lighton-ocr

- `LIGHTON_URL` (OpenAI-compatible chat-completions endpoint) is required. While empty,
  `/health` returns 503, the pod never goes Ready and the startup probe (5 minutes) restarts it.
- `HOME=/tmp` on an emptyDir is needed by LibreOffice (`soffice`) for docx/pptx conversion.
- The Dockerfile sets no `USER`; the chart runs it as uid 1001. That is reasoned, not tested -
  fall back to root if conversion fails.
- No authentication: do not expose it publicly.

## xyne-vespa

One chart, four roles, all running the same image: a single **configserver** (owns the
application package and the embedded ZooKeeper), one or more **content** nodes (proton /
storage), and the **feed** and **search** container clusters. Defaults are the configserver,
because every other role points at it and it is the first workload in Phase 5 of
`deploy/DEPLOYMENT-PLAN.md`.

- **`image.tag` must be set.** The image is not built from this repo, so `appVersion` is a
  `0.0.0` placeholder. Either the upstream `vespaengine/vespa` (what
  `vespa-core/deployment/docker-compose.dev.yml` runs) or the internal GPU build
  `asia.gcr.io/xyne-spaces/xyne-vespa-gpu` - the latter lives in the *prod* GCP project, so it
  needs `imagePullSecrets` for that registry.
- Every role reads `VESPA_CONFIGSERVERS`, which resolves to the configserver's **pod** DNS name.
  That name only exists because `service.clusterIP: None` makes the governing Service headless;
  keep it that way on the configserver and content roles. The value is templated, so the
  namespace follows the release:

  ```yaml
  env:
    VESPA_CONFIGSERVERS: vespa-configserver-0.vespa-configserver.{{ .Release.Namespace }}.svc.cluster.local
  ```

- The other three roles are installs of this chart with a `fullnameOverride`; the umbrella
  ships them under `xyne-vespa-content`, `xyne-vespa-feed` and `xyne-vespa-search`. Standalone:

  ```yaml
  # content - the 200 GiB proton node
  fullnameOverride: vespa-content
  args: [services]
  containerPorts: [{name: http, containerPort: 19107, protocol: TCP}]
  service:
    ports: [{name: http, port: 19107, targetPort: http}]
  readinessProbe: null
  resources: null
  persistence: {size: 200Gi}

  # feed - document API
  fullnameOverride: vespa-feed
  args: [services]
  containerPorts: [{name: http, containerPort: 8080, protocol: TCP}]
  service:
    clusterIP: null                      # load-balanced, not headless
    ports: [{name: http, port: 8080, targetPort: http}]
  podSecurityContext: null               # the feed container runs as root
  securityContext: {runAsUser: 0}
  podAnnotations:
    sidecar.istio.io/inject: null
    traffic.sidecar.istio.io/includeInboundPorts: "8080"
    traffic.sidecar.istio.io/includeOutboundPorts: "8080,8088"
  podAntiAffinityPreset: ""
  persistence: {enabled: false}

  # search - query API; same as feed minus the root user and the 8088 egress
  ```

  The `null`s are load-bearing: Helm merges maps, so `sidecar.istio.io/inject: null` is what
  removes the configserver's sidecar opt-out, and `clusterIP: null` is what turns the headless
  default back into a normal VIP.
- **Only ever run one configserver and one replication of each content bucket.** The chart
  pins `replicaCount: 1`, `autoscaling.enabled: false`, `pdb.enabled: false` (a PDB on one
  replica blocks node drains) and `podManagementPolicy: OrderedReady`.
- **`versionedName` must stay `false`.** It renames the StatefulSet, which orphans the volumes.
- `persistentVolumeClaimRetentionPolicy` is `Retain`/`Retain`: deleting the release leaves the
  data. The claims are named `data-<workload>-<ordinal>` (the sbx cluster used
  `vespa-data-...`); nothing adopts the old volumes, and `DEPLOYMENT-PLAN.md` calls for a full
  re-index anyway.
- **Readiness probes**: `/state/v1/health` on 19071 (configserver) and 8080 (feed, search).
  `vespa-content` ships **no** probe - 19107 is the storage node's state port and this has not
  been verified against the image; add one once you have. The sbx cluster runs all four with no
  probes at all, which makes rolling updates blind. `failureThreshold: 20` on a 15 s period
  allows five minutes of startup before a pod is considered failed.
- **Schemas are not deployed by this chart.** The application package reaches the configserver
  through `vespa deploy` (see `vespa-core/scripts/deploy-dev.sh`); the configserver comes up
  healthy but empty until it runs.
- GKE overlay, from `deploy/sbx-export/xyne-vespa/`:

  ```yaml
  image: {registry: asia.gcr.io/xyne-spaces, repository: xyne-vespa-gpu}
  imagePullSecrets: [gcr-xyne-spaces]
  persistence: {storageClass: premium-rwo}
  service:
    annotations: {cloud.google.com/neg: '{"ingress":true}'}
  nodeSelector: {v-role: content}        # feed/search: v-role=feed
  tolerations: [{key: v-role, operator: Equal, value: content, effect: NoSchedule}]
  ```

- `vespa-content` ships **no resource requests** because the sbx snapshot has none. Size it -
  the sandbox runs it on `e2-highmem-4`.
- Istio settings already in use for the two container clusters
  (`deploy/sbx-export/networking/`), if you enable `istio.virtualService` / `destinationRule`:
  feed is 60 s timeout, 3 retries on `connect-failure,reset`, `ROUND_ROBIN`, 500
  `http2MaxRequests`; search is 10 s timeout, no retries, `LEAST_CONN`, 1000.

## xyne-vespa-embedder

- GPU-only: `nvidia.com/gpu: 1` on requests and limits, and the `nvidia.com/gpu` toleration.
  The NVIDIA device plugin and drivers are cluster prerequisites. The sbx pool is one L4 with
  time-sharing across 10 clients.
- Model and batching are process arguments, not env: `--model-id BAAI/bge-base-en-v1.5`,
  `--max-client-batch-size 1000`, `--max-batch-requests 1000`, `--auto-truncate`. Changing the
  model changes the embedding dimensions, which must match the Vespa schemas.
- Serves 3000; the Service publishes **80**, because that is what `tei-batch-proxy` and the
  Vespa `hugging-face-embedder` component address. Health is `GET /health`.
- The Istio sidecar is disabled (`sidecar.istio.io/inject: "false"`).
- GKE overlay: `nodeSelector: {v-role: embedder-gpu}` plus the matching `NoSchedule` toleration.

## xyne-tei-batch-proxy

- Coalesces embedding requests before they reach the GPU. Upstream defaults to
  `http://vespa-embedder:80/v1/embeddings`, so the embedder chart must be installed in the same
  namespace (or `UPSTREAM_EMBEDDINGS_URL` retargeted).
- `image.tag` must be set - the source is not in this repo, so `appVersion` is a `0.0.0`
  placeholder.
- `PROXY_PAYLOAD_LIMIT_BYTES` is 200 MB and `REQUEST_TIMEOUT_MS` 120 s: a full batch of 512
  documents is large and slow. `MAX_RETRIES: "0"` - a retry would re-run the whole batch on the
  GPU.
- Single replica by default. It is stateless, so it scales horizontally, but every replica adds
  `UPSTREAM_CONCURRENCY` (4) concurrent streams against one GPU.

## xyne-spaces (umbrella)

- On by default: xyne-backend, xyne-dashboard, xyne-zero, xyne-ysweet. Everything else is off.
- `xyne-zero-replication` is the xyne-zero chart under an alias and already carries the
  replication-manager values; just enable it.
- `xyne-worker` covers one worker role. For more roles install the xyne-worker chart separately.
- The Vespa tier is six entries: `xyne-vespa` (configserver), the aliases `xyne-vespa-content`,
  `xyne-vespa-feed` and `xyne-vespa-search`, plus `xyne-vespa-embedder` and
  `xyne-tei-batch-proxy`. All are off by default and all need `image.tag` set except the
  embedder. Bring them up before the backend: `vespa-configserver` first, then the rest.
- `global.imageRegistry` overrides the registry of every sub-chart.
