# Per-User Frontend Bundle Serving — Implementation & Rollout Plan

## Goal

Serve a **per-user frontend bundle** from GCS. A user mapped to a specific bundle
folder gets that bundle; everyone else gets the **default** bundle. Unified across
the web dashboard and the Electron desktop app (Electron loads the same
`FRONTEND_URL`, so both share one path).

## Serving model (important)

**Serve-per-file, not download-a-zip.** The "bundle" is a folder of files in GCS.
The browser/Electron loads it as a normal SPA:

1. Navigation → nginx serves `index.html` (proxied from the user's GCS folder,
   `no-cache`).
2. `index.html` references hash-named assets → the browser requests each one →
   nginx routes each to the **same** GCS folder.
3. `version.json` is just another file in that folder.

This **replaces** the old Electron zip-OTA model (`ui-updater.ts` download →
extract → stage → swap). No zip, no staging.

## Decisions (locked)

| Topic | Decision |
|---|---|
| User identity | `userId` sent in a **cookie** (`x_bundle_uid`), set after login. No JWT decode, no header (a navigation can't set headers; only `index.html` needs the selector, and cookies auto-ride on assets too). |
| Selector → folder | nginx `map $cookie_x_bundle_uid $bundle_folder { include <map file>; }` |
| Mapping update model | Reload-based (pure stock nginx). Edit map file → `nginx -s reload`. Not a live API. |
| Mapping file source | A **GCS file** synced into the nginx pod (init + periodic refresh). |
| Default folder | Fixed **`default/`** in GCS. |
| Version tracking | **Per-folder `version.json`** in GCS. Version check reads the user's folder. |
| Missing file in GCS | Backend **falls back to the default folder** before 404. |
| Storage | **All** bundles (incl. default) in GCS bucket `xyne-frontend-bundles`. |

## Security note

`userId` in a header is **spoofable** — anyone can request another user's bundle.
Acceptable for staged rollout of **non-sensitive** frontend bundles. If bundles
ever carry sensitive/unreleased-but-confidential code, revisit (would require a
verified JWT via `auth_request` to the backend).

## Current state (as-is, from source)

- **Default/prod bundle is baked into the nginx image**, NOT GCS:
  `apps/dashboard/Dockerfile:88` builds `dist/`; `:114` copies it to
  `/usr/share/nginx/html`; nginx serves it via `try_files` (`nginx.conf:148`).
- **Electron OTA zip** is also baked: `dist → releases/dashboard.zip`
  (`Dockerfile:92-94, 117`), served at `/releases/dashboard.zip`.
- **GCS is used only for branch bundles today** — the devqa path. nginx maps a
  `devqa-xyne-*` **User-Agent** → `$bundle_branch` (`nginx.conf:46-49`), and if
  set, proxies to `/api/bundles/<branch>/*` (`nginx.conf:171-187`) →
  `BundleController.serveBundle` → streams `<branch>/<file>` from GCS bucket
  `xyne-frontend-bundles` (`GCS_BUNDLE_BUCKET_NAME`).
- **`version.json`** is emitted by Vite into `dist/` root as `{ version: pkg.version }`
  (`vite.config.ts` version-file plugin) and polled by the Electron version-checker
  at `${FRONTEND_URL}/version.json` (`version-checker.ts:19`).

The devqa mechanism is the exact template: selector-in-request → proxy → GCS.
Difference: devqa's request **names the folder** (no lookup); per-user needs a
**userId → folder lookup** because a userId is not a folder name.

## Target architecture

```
Browser/Electron  ──(nav + X-Bundle-User-Id header)──►  nginx (stock)
                                                          │
                        map $http_x_bundle_user_id ───────┤ include /etc/nginx/bundle-map.conf
                        $bundle_folder                     │   "userId_abc" "beta-v2";
                                                           │   (default "")
                                                           │
          folder set (mapped user) ──► @bundle_proxy ──► /api/bundles/<folder>/*  ─┐
          folder empty (default)   ──► @bundle_proxy ──► /api/bundles/default/*  ──┤
                                                                                   ▼
                                                        Backend pod  ── streams <folder>/<file>
                                                          │            from gs://xyne-frontend-bundles
                                                          └─ if file missing → retry default/<file>
```

Every request in a page load (index.html, assets, version.json) carries the same
header → same folder → self-consistent bundle.

## Work items

### 1. Backend (`apps/backend`)
- `bundleController.ts`: in `streamBundleFile`, if `<folder>/<file>` is missing in
  GCS, **retry against `default/<file>`** before returning 404. (Keeps the SPA
  index.html fallback too.)
- **Remove** the PR #981 DB approach: drop `UserBundleOverride` model + migration +
  `bundleOverrideService.ts` + admin routes + `serveUserBundle`/`/me` route +
  `DEFAULT_BUNDLE_NAME` env. The existing public `GET /api/bundles/:branchName/*`
  is all the backend needs (nginx supplies the folder).
- Config: add `defaultBundleFolder = 'default'` constant (or keep hardcoded).

### 2. nginx (`apps/dashboard/nginx.conf`)
- Add `map $http_x_bundle_user_id $bundle_folder { default ""; include /etc/nginx/bundle-map.conf; }`
- In `location /` and the asset `location`: if `$bundle_folder != ""` → proxy to
  `/api/bundles/$bundle_folder/*`; **else** proxy to `/api/bundles/default/*`
  (so the default also comes from GCS, not the baked image). Mirror the existing
  `@bundle_proxy` blocks.
- Keep the devqa User-Agent path working (or fold both into one decision).
- Ensure `version.json` is NOT special-cased to local — it must route through the
  per-user proxy so each user gets their folder's version.

### 3. GCS map sync (nginx pod)
- Init container / sidecar (or entrypoint step) that pulls the map file from GCS
  (e.g. `gs://xyne-frontend-bundles/_config/bundle-map.conf`) to
  `/etc/nginx/bundle-map.conf` on start, then periodically re-pulls and
  `nginx -s reload` on change.
- Map file format (nginx `map` include syntax):
  ```
  "userId_abc"  "beta-v2";
  "userId_xyz"  "canary";
  ```

### 4. CI / build — upload dist → GCS (NEW; does not exist today)
- On release, upload `apps/dashboard/dist/` to
  `gs://xyne-frontend-bundles/default/` (its `version.json` inside drives updates).
- Override folders (`beta-v2`, etc.) uploaded by whatever process builds them.
- **Owner TBD** — no in-repo CI currently uploads to `xyne-frontend-bundles`;
  need to know the CI system (GitHub Actions / GitLab / other).

### 5. Client (dashboard + Electron) — send the header
- After login, the client must attach `X-Bundle-User-Id: <userId>` to requests for
  the entry + assets. NOTE: a top-level **navigation cannot set a custom header** —
  so for the very first document load this must be a **cookie** nginx reads
  (`$cookie_x_bundle_uid`) rather than a header, OR the entry is loaded via a
  fetch/SW that can set headers. **Open question — see below.**

## RESOLVED: selector is a cookie

A browser **navigation** (the top-level `index.html` load) cannot carry a custom
request header — only cookies are auto-sent. The only request that needs the
selector is the `index.html` navigation: `index.html` is self-describing (it
hard-codes its build's hashed asset paths), so once the right `index.html` is
served, the assets already point at the correct files. The cookie also auto-rides
on same-origin asset requests, so nginx uses `$cookie_x_bundle_uid` uniformly for
`index.html`, assets, and `version.json`. **No header anywhere.**

Client wiring: set cookie `x_bundle_uid=<userId>` after login (path=/, same
site as the app). Logged out → no cookie → default folder.

## Logged-out behavior

No cookie/header → `$bundle_folder` empty → default folder. Login sets the
cookie; next load (or a post-login reload) serves the user's bundle. Matches the
agreed "default when logged out, user bundle after login + reload" model.

## Rollout order

1. Backend fallback + strip #981 DB bits (safe, no behavior change alone).
2. CI uploads `dist → gs://.../default/` (so GCS has a default to serve).
3. nginx routes default through GCS proxy (cutover from baked image — test
   carefully; this changes what serves the SPA).
4. Map sync + first override folder + a test user.
5. Client selector (cookie) wiring for real per-user targeting.

## What PR #981 becomes

Repurpose the branch: remove Prisma model/migration/service/admin/`/me` route/env;
keep only the backend GCS-missing→default fallback; add nginx + map-sync. (Pending
your confirm.)
```
