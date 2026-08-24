# SDLC fast lane

The SDLC surface ships on its own cadence, independent of the main release train.
It is the **same source tree** built a second time with different env, deployed as
its own frontend image, backend Deployment and zero-cache, and embedded by the
main dashboard in an iframe.

Nothing here is active by default. With the lane's env vars unset, both the main
bundle and the main backend build and behave exactly as they did before.

---

## Shape

```
                       one origin: app.spaces.xyne.juspay.net
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        │      edge (prod: GKE Ingress · sandbox: GCLB → NEGs)         │
        └──┬────────────┬─────────────┬──────────────┬───────────────┘
           │            │             │              │
      /*   │      /api/*│    /zero/*  │  /sdlc-app/* │  /sdlc-api/*
           │            │             │              │  /sdlc-zero/*
           ▼            ▼             ▼              ▼
     ┌──────────┐ ┌──────────┐ ┌───────────┐  ┌──────────────────────┐
     │ dashboard│ │ backend  │ │zero-cache │  │  SDLC lane           │
     │  (main)  │ │ (main)   │ │  (main)   │  │  dashboard / backend │
     └──────────┘ └──────────┘ └───────────┘  │  / zero-cache        │
                                              └──────────────────────┘
     main release train ───────────────────►   ships independently ──►
```

The main bundle frames `/sdlc-app/...` for its `/sdlc` routes. The iframe is
owned by `SdlcFrameHost`, mounted above the router and portalled to `document.body`,
so leaving `/sdlc` hides it rather than destroying it and returning is instant.
The SDLC bundle serves that path with the app chrome hidden, so it looks like an
ordinary panel.

**Same origin on purpose.** The SDLC lane is a *path* on the main host, never a
subdomain. That keeps the `SameSite=strict` auth cookies working with no widening
of their `Domain`, and it makes URL path the single routing signal — the only
mechanism that works for the iframe document, XHR **and** the Zero WebSocket
alike. A browser cannot attach a custom header to an iframe navigation or to a
`WebSocket`, and a cookie is scoped to the origin rather than to a frame, so
neither headers nor cookies can route these three consistently. Do not move the
lane to a subdomain, or switch routing to a cookie, without revisiting all three.

---

## No prefix rewriting is required

Every SDLC service answers on its prefix directly, so the edge only has to
*match and forward*. In production that is a hard requirement, not a preference:
the GCE-class Ingress fronting `spaces.xyne.juspay.net` has no rewrite capability
at all, which is exactly why `/api/` and `/zero/` reach their services unrewritten
today.

| Prefix | Handled by | How |
| --- | --- | --- |
| `/sdlc-app/*` | SDLC frontend image | Built with `VITE_APP_BASE_PATH=/sdlc-app/`, so Vite emits `/sdlc-app/assets/…`, and the image stores its files under that subdirectory (`STATIC_SUBDIR=sdlc-app`). nginx serves the SPA fallback from `/sdlc-app/index.html`. |
| `/sdlc-api/*` | SDLC backend | `API_PATH_PREFIX=/sdlc-api` — the first middleware in `app.ts` rewrites the path onto `/api` internally, so every route stays mounted exactly once. |
| `/sdlc-zero/*` | SDLC zero-cache | zero-cache matches its sync route by suffix and accepts any leading prefix. Verified against a running instance: a WebSocket upgrade to `/sync/v51/connect`, `/zero/sync/v51/connect` and `/sdlc-zero/sync/v51/connect` all return `101 Switching Protocols`. (Its `/keepalive` endpoint is root-only, which is unrelated — the client never calls it under a prefix.) |

---

## Edge configuration

The two clusters differ, so check which one you are targeting.

### Production — a GKE Ingress with plain prefix rules

`xyne-ing` in `xyne-apps` fronts `spaces.xyne.juspay.net`. It is a GCE-class
Ingress (pre-shared cert, `k8s1-…` NEG backends) and every existing rule is a
plain `Prefix` → Service with **no rewrite annotation**:

```
Prefix  /api/        -> xyne-backend:3001
Prefix  /zero/       -> xyne-spaces-zero:8080
Prefix  /claw        -> xyne-claw-auth-frontend:8083
Prefix  /external/   -> xyne-dashboard-external:8080
Prefix  /            -> xyne-dashboard:8080          # catch-all, last
```

`/claw` and `/external/` are the precedent worth noting: **separate frontend
deployments already served under a path prefix on the same host.** The SDLC lane
is a third instance of that, not a new idea.

Add three rules ahead of the `/` catch-all:

```yaml
- path: /sdlc-app/
  pathType: Prefix
  backend: { service: { name: xyne-sdlc-dashboard, port: { number: 8080 } } }
- path: /sdlc-api/
  pathType: Prefix
  backend: { service: { name: xyne-sdlc-backend,   port: { number: 3001 } } }
- path: /sdlc-zero/
  pathType: Prefix
  backend: { service: { name: xyne-sdlc-zero,      port: { number: 8080 } } }
```

A GCE-class Ingress cannot rewrite paths at all, so the no-rewrite design is a
hard requirement here rather than a preference — and it is why `/api/` and
`/zero/` reach their services unrewritten today.

### Sandbox — standalone NEGs, no Ingress

There is no Ingress object; Services are `ClusterIP` with
`cloud.google.com/neg: {"ingress":true}` and a GCLB targets the NEGs from
outside the cluster. The work there is a backend service per NEG plus URL map
path rules. A GCLB URL map *can* rewrite — do not use it. Both prefixes are
load-bearing by the time the request lands: the backend maps `/sdlc-api` onto
`/api` itself, and the frontend's assets live under `/sdlc-app/` on disk, so a
prefix strip at the edge is a double-strip.

## Following the existing lane pattern

The cluster already runs several parallel lanes — `playground`, `external`,
`mtls`, `demo` — and each is the same four-part set. Copy it rather than
inventing a new shape:

| Lane component | Existing example | SDLC equivalent |
| --- | --- | --- |
| dashboard | `xyne-dashboard-playground` | `xyne-sdlc-dashboard` |
| backend | `xyne-backend-playground` | `xyne-sdlc-backend` |
| zero view-syncer | `xyne-spaces-zero-playground` | `xyne-sdlc-zero` |
| zero replication-manager | `xyne-spaces-zero-replication-playground` | *optional — see below* |

Deployments are named `<component>-<commit-sha>` and created fresh per build,
with a stable Service selecting them by label.

## The lane's config lives in two env files

Both are **tracked** — the gitignore excludes `.env`, `.env.local` and
`.env.*.local`, not `.env.sdlc`. Neither holds secrets; machine-specific
overrides go in the gitignored `.env.sdlc.local` beside them.

| File | Loaded by | Holds |
| --- | --- | --- |
| `apps/dashboard/.env.sdlc` | `vite --mode sdlc` (`dev:sdlc`, `build:sdlc`) | surface, base path, API base override, zero path, zero storage key, dev port |
| `apps/backend/.env.sdlc` | `dotenv -e .env.sdlc -e .env.local` (`dev:sdlc`) | `PORT`, `API_PATH_PREFIX` |

Two precedence rules to know, because they differ:

- **Vite**: an env var that already exists in the shell **wins over every `.env`
  file**, so a Docker `ENV` silently shadows `.env.sdlc`. This is why the lane
  uses its own `VITE_ZERO_PATH` rather than overriding `VITE_ZERO_SERVER`, which
  the Dockerfile bakes to an absolute URL.
- **dotenv-cli**: the **first** `-e` file wins (it does not override
  already-set variables). Hence `-e .env.sdlc -e .env.local` in that order.

## Building the SDLC images

Frontend — same Dockerfile, three build args; everything else comes from
`.env.sdlc`:

```bash
docker build -f apps/dashboard/Dockerfile . \
  --build-arg BUILD_SCRIPT=build:sdlc \
  --build-arg STATIC_SUBDIR=sdlc-app \
    -t xyne-sdlc-dashboard
```

`VITE_ZERO_STORAGE_KEY` (set to `sdlc` in `.env.sdlc`) **must** differ from the
main bundle's. It is what gives the SDLC Zero client its own IndexedDB; without
it the two clients share one store on the origin and wipe each other on any
workspace switch, re-auth, logout or schema refresh (see
`apps/dashboard/src/zero/dropZeroDatabases.ts`).

Backend — the existing image, with `PORT` and `API_PATH_PREFIX=/sdlc-api` set
from the deployment (the same values `.env.sdlc` uses locally).

**Run the API only — no worker.** The worker is a separate entrypoint
(`start:worker`) consuming shared BullMQ queues. A second worker on the same
Redis would double-process every job in the main lane. Repository access checks
run inline in the API process, so they do not need one.

zero view-syncer — see the deployment step below; it consumes the existing
change stream and points its mutate/query URLs at the SDLC backend.

---

## Local development

```bash
pnpm run up         # or: pnpm dev
```

Pick **"Core + SDLC lane"** at the app prompt. Or select `sdlc-backend` and
`sdlc-dashboard` under "Pick apps", or skip the prompt entirely:

```bash
XYNE_DEV_APPS=dashboard,backend,worker,sdlc-backend,sdlc-dashboard pnpm dev
```

| Process | Port | Script |
| --- | --- | --- |
| dashboard (main) | 5173 | `dev` |
| backend (main) | 3001 | `dev` |
| sdlc-dashboard | 5175 | `dev:sdlc` |
| sdlc-backend | 3011 | `dev:sdlc` |

The lane is **not** an entry in the infra feature picker (the one that asks about
Claw, Canvas, Calls, Search…). That picker chooses docker containers, and this
lane needs none — it is two extra node processes plus proxy rules.

Locally the lane shares the main zero-cache on 4848 rather than running a second
one; both lanes read the same Postgres, so a second cache would add setup for no
coverage. Point `VITE_SDLC_ZERO_SERVER` at one to exercise the real two-cache
shape.

Open **http://localhost:5173** as usual. The main vite server plays the part the
edge plays in a deployed environment: it proxies `/sdlc-app`, `/sdlc-api` and
`/sdlc-zero` to the lane's processes. That keeps the iframe same-origin in dev
exactly as in prod, so cookie behaviour is the same and there is no dev-only
routing quirk to debug around.

Do not open `http://localhost:5175` directly — the bundle expects to be reached
through the main origin.

Both lanes share one Postgres and one Redis locally, matching the deployed shape.

---

## Deploying to production

### The ordering constraint that matters

**Deploy the SDLC lane before the main bundle.** The main bundle's `/sdlc` route
no longer renders the SDLC screen inline — it renders an iframe pointing at
`/sdlc-app`. Ship main first and every user's SDLC tab is a blank frame until the
lane and its Ingress rules exist. That is an outage of the surface, caused purely
by ordering.

Note also that **the first rollout is not independent**: it needs a main-lane
release, because the main bundle has to learn to frame the lane. Independence
starts from the second SDLC deploy onward.

### Order of operations

1. **Land the migrations** (normal release train, ahead of everything else).
   Three SDLC migrations, all additive and nullable, no backfill required:
   `20260808162841_add_sdlc_hub`, `20260810144756_remove_sdlc_vcs_runtime_grants`,
   `20260814090000_remove_project_sdlc_board`. Safe to apply while the current
   main build is running — nothing reads the new columns yet.

2. **Deploy the SDLC backend.** Existing backend image, no rebuild needed — it is
   the same code with different env:

   ```
   PORT=3001
   API_PATH_PREFIX=/sdlc-api
   ```
   plus the same database, Redis and secret set as the main backend.

   **API only — do not start the worker.** It is a separate entrypoint
   (`start:worker`); a second worker on the same Redis double-processes every job
   in the main lane. Repository access checks run inline in the API process, so
   they do not need one.

3. **Deploy the SDLC zero view-syncer** — see the phasing note below; you may be
   able to skip this on day one.

   Zero is already split here into a view-syncer and a replication-manager, so a
   second view-syncer can consume the EXISTING change stream and adds **no new
   replication slot**:

   ```
   ZERO_CHANGE_STREAMER_URI=http://xyne-spaces-zero-replication:80
   ZERO_MUTATE_URL=http://xyne-sdlc-backend:3001/api/zero/push
   ZERO_QUERY_URL=http://xyne-sdlc-backend:3001/api/zero/query
   ZERO_UPSTREAM_DB / ZERO_CVR_DB                     same as the main lane
   ZERO_REPLICA_FILE=/var/zero/replica.db
   ZERO_QUERY_FORWARD_COOKIES=true
   ZERO_MUTATE_FORWARD_COOKIES=true
   ZERO_PORT=4848
   ```

   Sharing the replication-manager is the cheaper option and is what removes the
   WAL concern below. The other lanes each run their own replicator
   (`xyne-spaces-zero-replication-playground` and friends) — copy that only if
   the SDLC lane genuinely needs an independent replication position.

4. **Build and deploy the SDLC frontend image:**

   ```bash
   docker build -f apps/dashboard/Dockerfile . \
     --build-arg BUILD_SCRIPT=build:sdlc \
     --build-arg STATIC_SUBDIR=sdlc-app \
          -t xyne-sdlc-dashboard
   ```

5. **Add the Ingress rules** (see "Edge configuration" above) — `/sdlc-app`,
   `/sdlc-api`, `/sdlc-zero`, all `pathType: Prefix`, above the `/` catch-all. No
   rewrite annotations.

6. **Verify the lane standalone, before main can reach it.** Hit
   `https://<host>/sdlc-app/<workspaceId>/sdlc` directly in a browser. It should
   render the SDLC Hub chromeless. If this fails, stop — do not proceed to step 7,
   because that is what makes it user-visible.

7. **Redeploy the main dashboard** from this branch. No new build args: the main
   bundle's defaults are unchanged, and `VITE_SDLC_APP_BASE_PATH` falls back to
   `/sdlc-app` in `config.ts`.

   Deliberately do **not** set `ZERO_STORAGE_KEY` on the main image. Leaving it
   empty keeps main's IndexedDB name byte-identical, so the rollout does not force
   a full Zero resync for every user.

### Consider skipping the second zero-cache on day one

Point the SDLC bundle at the existing cache (`VITE_ZERO_PATH=/zero` in `.env.sdlc`) and
drop the `/sdlc-zero` Ingress rule. You still get independently deployable SDLC
frontend and backend, which is most of the benefit, and you avoid the second
replication slot entirely on the riskiest day.

What you give up until you add it: the lane cannot change the Zero schema or
mutators independently, because the shared cache forwards mutations to the *main*
backend. Add the cache when the lane actually needs to diverge — that is the
point where the WAL supervision below starts to matter.

### Rollback

Redeploy the previous main dashboard image. Its `/sdlc` route renders the SDLC
screen inline again and stops referencing `/sdlc-app` entirely. The lane's own
services can keep running or be scaled to zero — nothing else points at them.
Nothing needs to be undone in the database: the migrations are additive, and the
previous build simply ignores the new columns.

---

## Rules that keep the lanes independent

1. **Schema changes stay on the slow train.** One Postgres serves both lanes.
   Migrations must be additive and backward compatible — nullable columns, no
   drops, no renames, no type changes — and should land through the normal
   release train *ahead* of the SDLC code that uses them. Application code moves
   fast; schema does not.
2. **Keep `packages/shared/src/zero/schema.ts` identical across lanes** at any
   given deploy. Each zero-cache only replicates the tables its own schema
   declares, so additive DDL is invisible to the other lane — but a client whose
   schema version disagrees with its cache gets `SchemaVersionNotSupported`,
   which drops local state and reloads.
3. **Rebase onto `main` frequently.** Deployment separation does not reduce merge
   conflicts; only editing fewer shared registries does. The hot files are
   `zero/schema.ts`, `zero/queries.ts`, `zero/mutators.ts`, `acl/tables/index.ts`,
   `AppRoot.tsx` and `navigationConfig.ts`.
4. **Only add a replication slot deliberately.** A second view-syncer pointed at
   the existing `xyne-spaces-zero-replication` adds no slot and needs no extra
   supervision — that is the recommended shape. If instead the lane gets its own
   replication-manager, it does add a slot, and Postgres retains WAL until every
   slot has consumed it: a stalled or scaled-to-zero replicator can then fill the
   primary's disk and take down the main product. In that case set
   `max_slot_wal_keep_size` and alert on `pg_replication_slots.wal_status` before
   it goes live.

---

## Known trade-off

The SDLC bundle currently builds the **entire** app — it shares the main route
table so that neither bundle diverges. That keeps the diff small and rebases
cheap, at the cost of a large bundle for one screen. Giving the SDLC lane its own
entry with only SDLC routes would shrink it, but introduces permanent structural
divergence in `AppRoot.tsx` — already one of the hottest rebase files. Worth
revisiting once the lane is stable and its real divergence is known.
