# Dashboard edge

A small CDN-style layer that serves the dashboard SPA from object storage
instead of from images with the bundle baked in. One deployment replaces the
per-environment nginx pods (`xyne-dashboard`, `xyne-dashboard-02`,
`xyne-dashboard-sdlc`): a rules file decides which bundle each request gets,
misses are fetched from the bucket and cached on local disk, and pushing a
bundle to its prefix is the release.

Two processes in one container:

- **nginx** (stock `nginx:alpine`, config only): disk cache, SPA fallback,
  gzip, security headers. No scripting.
- **edge app** (Node 22, TypeScript, `src/`): resolves rules, hot-reloads the
  rules file, health-checks and fingerprints bundles, fetches objects through
  the official storage SDKs via `@xyne/storage`, and serves status and
  metrics. Bound to loopback; nginx is the only thing that talks to it.

## How a request is served

1. nginx runs an `auth_request` subrequest to the app's `/resolve` before
   touching the cache. The app matches the request (path, headers, cookies,
   user agent) against the rules and answers with headers: rule id, bundle,
   cache key version, object path, cache mode, bypass and SPA flags.
2. nginx looks the object up in `proxy_cache` under
   `bundle | version-fingerprint | object`. On a miss it proxies to the
   app's `/objects/<bundle>/<object>`, which streams the object from storage
   with `Content-Type` and the browser `Cache-Control` already set, so the
   cached copy carries them. Concurrent misses coalesce.
3. If the origin says 404 and the path has no extension, it is a client-side
   route: nginx retries `<bundle>/index.html` through the same cache. Paths
   with an extension return a real 404.
4. nginx adds the security headers and `X-Edge-*` diagnostics on every
   response.

## Rules file

JSON, one object with a `rules` array. Evaluated in order, first match wins,
the last rule must be the catch-all default. Full examples in
`rules.example.json` and `k8s/configmap-rules.yaml`.

```json
{
  "id": "playground-cookie",
  "match": { "cookie": { "name": "x-route-env", "regex": "^playground$" } },
  "bundle": "main",
  "version": 3,
  "cache": "versioned",
  "strip_prefix": "/sdlc-app"
}
```

| Field | Meaning |
|---|---|
| `id` | Unique name, `[A-Za-z0-9_.-]+`. Shows up in `X-Edge-Rule`, logs and metrics. |
| `match.path_prefix` | Request path starts with this. `"/"` alone marks the default rule. |
| `match.path_regex` | JavaScript regex on the path. Captures are usable in `bundle`. |
| `match.header` | `{ "name", "exact" \| "regex" }`. Name is case-insensitive. |
| `match.cookie` | `{ "name", "exact" \| "regex" }`. |
| `match.user_agent` | `{ "regex" }`. |
| `bundle` | Prefix in the bucket whose root holds a built dist (`<bundle>/index.html` must exist). May reference regex captures as `$1`..`$9`. |
| `version` | Any string or number, default `1`. Part of the cache key: bump it to force an invalidation by hand. Usually unnecessary, see fingerprints below. |
| `cache` | `versioned` (default), `never`, or `ttl`. See below. |
| `ttl` | Seconds, `"60s"`, `"5m"`... Required for `cache: ttl`. |
| `strip_prefix` | Removed from the path before the bucket lookup, for bundles built with a non-root base such as `/sdlc-app/`. |

All matchers in one rule must hold. Several rules can point at the same
bundle (a header rule and a cookie rule for the same lane, for example).

### Cache modes and invalidation

- **versioned**: the edge caches for as long as the entry is used. Freshness
  is controlled by the key, which holds the rule's `version` and the origin
  fingerprint of the bundle's `index.html` (its ETag). The app re-checks
  every static bundle at the origin every `EDGE_HEALTH_INTERVAL` seconds
  (default 30), so re-uploading a bundle under the same prefix, which is what
  the Jenkins pipeline does, changes the key and every old entry becomes
  unreachable with no edit. Changing `bundle` or `version` does the same by
  hand. Old entries age out on their own. Bundles built from regex captures
  (devqa) are fingerprinted on their per-request existence check, cached for
  60 seconds.
- **never**: every request goes to the origin, nothing is stored at the edge,
  and the browser gets `no-cache` on every path. Use it for devqa branches
  that are re-pushed under the same name. Responses show `X-Edge-Cache: BYPASS`.
- **ttl**: like versioned, but the key also carries a time bucket of `ttl`
  seconds, so entries roll over on a timer with no edit.

### Reload and validation

The rules file is re-read every `EDGE_RELOAD_INTERVAL` seconds (default 5).
When its content changes it is validated (zod schema plus semantic checks),
every static bundle is checked with a metadata call on its `index.html`, and
the new set becomes active. A file that fails validation is logged and
ignored; the last good set stays live and `/_edge/status` shows
`last_error`. A rule whose bundle is missing keeps the bundle it was serving
before and is reported unhealthy; with nothing to fall back to it is
disabled and requests fall through to the next rule. Dynamic bundles built
from regex captures (the devqa rule) are checked per request with a short
cache; an unknown branch falls through to the next rule and the response
carries `X-Edge-Skipped` saying why. A disabled rule recovers on its own
once its bundle appears.

With a ConfigMap mount the kubelet takes up to about a minute to sync an
edit; the app picks it up on its next tick after that.

## Storage backends and credentials

Set `STORAGE_BACKEND` and the variables for that backend. Credentials are
resolved by the provider SDK's default chain, the same way as in the backend,
so nothing here is edge-specific.

| Backend | Variables | Credentials |
|---|---|---|
| `gcs` (default) | `STORAGE_BUCKET`, `STORAGE_ENDPOINT` (emulator only), `GOOGLE_CLOUD_PROJECT` (optional) | Google Application Default Credentials: `GOOGLE_APPLICATION_CREDENTIALS` (a mounted key), GKE Workload Identity, GCE metadata, workload identity federation. `@google-cloud/storage` via `@xyne/storage`. |
| `s3` | `STORAGE_BUCKET`, `STORAGE_ENDPOINT` (MinIO, Ceph, GCS interop; forces path style), `AWS_REGION` | AWS default provider chain: env vars, shared config, EKS IRSA and Pod Identity, ECS and EC2 metadata. `@aws-sdk/client-s3` via `@xyne/storage`. |
| `azure` | `STORAGE_BUCKET` (container), `AZURE_STORAGE_ACCOUNT` or `STORAGE_ENDPOINT` | `DefaultAzureCredential` (env vars, workload identity, managed identity), or `STORAGE_AUTH=sas` with `AZURE_STORAGE_SAS_TOKEN`. `@azure/storage-blob` via `@xyne/storage`. Untested against a real account. |
| `http` | `STORAGE_ENDPOINT` (base URL) | Optional `STORAGE_AUTH_HEADER` sent as `Authorization`. Any server exposing `<base>/<bundle>/<object>`. |

`STORAGE_AUTH` is `sdk` by default; `none` is for public buckets and
emulators (for GCS a custom endpoint already implies it); `sas` is Azure-only.

To mount a GCP service-account key instead of Workload Identity:

```sh
kubectl -n xyne-apps create secret generic xyne-dashboard-edge-gcp-key --from-file=key.json=sa.json
```

then set `GOOGLE_APPLICATION_CREDENTIALS=/etc/edge/gcp/key.json` and
uncomment the `gcp-key` volume and mount in `k8s/deployment.yaml`. The key
needs `roles/storage.objectViewer` on the bucket. For AWS, mount a secret as
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or annotate the service
account for IRSA; for Azure use workload identity or the `AZURE_*` env vars.

Other settings: `EDGE_RULES_FILE` (default `/etc/edge/rules/rules.json`),
`EDGE_RELOAD_INTERVAL` (default 5), `EDGE_HEALTH_INTERVAL` (default 30),
`EDGE_APP_PORT` (default 9101), `EDGE_SYSLOG_PORT` (default 9102),
`CACHE_MAX_SIZE` (default `2g`), `CACHE_INACTIVE` (default `7d`),
`CACHE_TTL` (default `30d`), `LOG_LEVEL` (`debug`, `info`, `warn`, `error`).

## Endpoints

| Path | Purpose |
|---|---|
| `/_edge/healthz` | Liveness: the app is up. |
| `/_edge/ready` | Readiness: rules loaded and the default rule healthy. |
| `/_edge/status` | JSON: every rule with its resolved bundle, version, fingerprint, cache mode, health and last error; storage description; last reload and health check. |
| `/_edge/metrics` | Prometheus: `edge_requests_total{rule,cache,status}` (from nginx's access log, shipped over local syslog), `edge_upstream_errors_total{rule}`, `edge_resolve_total{rule}`, `edge_origin_requests_total{result}`, `edge_rule_healthy{rule}`. |

nginx refuses these for requests carrying `x-original-host`, which the
VirtualService sets on external traffic, so they are only reachable inside
the cluster or via `kubectl port-forward`.

Every response carries `X-Edge-Rule`, `X-Edge-Bundle`, `X-Edge-Version`
(the cache key's version and fingerprint), `X-Edge-Object`, `X-Edge-Cache`
(`HIT`, `MISS`, `STALE`, `UPDATING`, `BYPASS`, or empty when nothing was
proxied) and, when a matching rule was skipped, `X-Edge-Skipped`.

## Bundle layout and the Jenkins pipeline

A bundle is a prefix in the bucket holding a built `dist/` at its root, plus
`releases/dashboard.zip` for the Electron updater. The Jenkins pipeline in
`xyne-spaces-infra` uploads one on every build, to a flat prefix per lane
that is overwritten in place (the shape the devqa uploads always had):

| Lane | Prefix | Uploaded from |
|---|---|---|
| public `main` | `main` | the Docker push phase, exported from the image build with `make export-dashboard-bundle` |
| `release-YYYYMMDD` | `release-YYYYMMDD` (the branch name) | the Docker push phase, same export |
| devqa branch | `devqa-xyne-<name>` | the source build on the agent (unchanged, so the user-agent rule keeps working) |
| any other branch | the branch name with its `fix/`, `feat/` or `feature/` prefix stripped and `/` replaced by `-` | the source build on the agent |
| SDLC build of any of the above | `<lane>-sdlc` (for example `main-sdlc`) | the same build as the lane, run with `build:sdlc` (base `/sdlc-app/`); `ENABLE_STAGE_UPLOAD_SDLC_BUNDLE` in the Jenkinsfile, on by default |

Bundle names are lanes, never commit hashes: a lane is rewritten on every
build, and the version of what a lane holds is inside its `version.json`
(the semantic-release version, for example `1.184.0` on `main`). The push
is the release: the edge notices the new `index.html` fingerprint within its
health interval and starts serving the new bundle. Rollback is
re-running the pipeline for the previous commit. The upload writes hashed
assets first and `index.html` last so a client can never load a new
`index.html` whose assets are not there yet, and prunes files from older
builds.

`make export-dashboard-bundle` builds the `bundle` stage of
`apps/dashboard/Dockerfile` (dist plus the Electron zip, nothing else) into
`out/dashboard-bundle`; the builder stage is shared with the image build so
it comes from cache.

## Build, deploy, cutover

```sh
make build-dashboard-edge     # local image (build context is the repo root)
make push-dashboard-edge      # asia.gcr.io/xyne-spaces/xyne-spaces-dashboard-edge:<sha>
```

1. Create the bucket access: either Workload Identity (`k8s/serviceaccount.yaml`
   has the gcloud commands) or a mounted key (above).
2. Apply `k8s/serviceaccount.yaml`, `k8s/configmap-rules.yaml` with the rules
   pointing at prefixes that exist, `k8s/deployment.yaml` with the image tag,
   and `k8s/service.yaml`.
3. Check `kubectl -n xyne-apps port-forward deploy/xyne-dashboard-edge 8080` and
   `curl localhost:8080/_edge/status`.
4. Add a temporary VirtualService route so you can test through the gateway
   before flipping anything:

   ```yaml
   - match:
       - headers:
           x-route-env:
             exact: edge
         uri:
           prefix: /
     route:
       - destination:
           host: xyne-dashboard-edge.xyne-apps.svc.cluster.local
           port:
             number: 8080
   ```

5. Flip the `/` routes (default, onyx header, playground header and cookie)
   and the `/sdlc-app/` route to `xyne-dashboard-edge`. The onyx and
   playground `/` routes can then be removed from the VirtualService, since
   the edge's own rules handle those headers and cookies.
6. After a day, scale the old dashboard deployments to zero, then delete them
   and the `push-dashboard` image build once nothing references it.

Rollback at any step is reverting the VirtualService; the old pods keep
running until step 6. The old nginx config's `/migration/` proxy is not
carried over: the VirtualService already routes `/migrate/` straight to that
service.

## Development

```sh
pnpm --filter xyne-spaces-dashboard-edge run typecheck
pnpm --filter xyne-spaces-dashboard-edge run lint
pnpm --filter xyne-spaces-dashboard-edge run test        # vitest, pure matcher and schema
pnpm --filter xyne-spaces-dashboard-edge run dev         # tsx watch, app only (no nginx)
```

Full local run against emulators, with nginx in front:

```sh
cd apps/dashboard-edge/local
docker compose up --build -d
./seed.sh                                                              # buckets + four sample bundles
curl -si localhost:8089/ | head -20                                   # GCS-backed edge (fake-gcs-server)
curl -si -H 'x-route-env: playground' localhost:8089/ | head -20     # header rule, ttl cache
curl -si -A 'devqa-xyne-feature-x' localhost:8089/ | head -20        # regex capture, cache: never
curl -si localhost:8089/sdlc-app/ | head -20                          # strip_prefix
curl -si localhost:8089/some/client/route | head -20                  # SPA fallback
curl -si localhost:8090/ | head -20                                   # same rules, S3 backend on MinIO
curl -s localhost:8089/_edge/status | jq
```

Edit `local/rules.json` in place (the file is bind-mounted, so use an editor
that rewrites rather than renames) and watch `X-Edge-Bundle` change within
two seconds. Re-run `./seed.sh` with changed content and watch
`X-Edge-Version` change within the health interval.

## Layout

```
Dockerfile                 app build (pnpm workspace) + nginx:alpine runtime with Node
docker-entrypoint.sh       renders nginx.conf, starts the app, runs nginx
nginx/nginx.conf           cache zone, auth_request resolver, /_edge guard, SPA fallback
nginx/proxy-origin.conf    proxy + cache settings shared by / and @spa
src/main.ts                bootstrap
src/config.ts              env -> Config (zod)
src/rules/schema.ts        rules file schema, validation, normalisation
src/rules/match.ts         pure matcher: rules x request -> bundle + object + key version
src/rules/store.ts         load, validate, health-check, fingerprint, hot-reload
src/origin/                storage (gcs/s3/azure via @xyne/storage), http
src/http/                  /resolve, /objects, /_edge handlers and router
src/metrics.ts             Prometheus registry + syslog listener for nginx access lines
src/contentType.ts         Content-Type and Cache-Control policy
k8s/                       ServiceAccount, ConfigMap, Deployment, Service
local/                     compose harness with fake-gcs-server and MinIO
```
