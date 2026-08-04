## Type of Change

- [ ] Bugfix
- [ ] New feature
- [ ] Enhancement
- [ ] Refactoring
- [ ] Dependency updates
- [ ] Documentation
- [ ] CI/CD

## Description
<!-- What changed, and why. Link the ticket (XYNE-xxxx) or issue. -->


## Areas Touched

- [ ] `apps/backend` (API / worker)
- [ ] `apps/dashboard`
- [ ] `apps/electron`
- [ ] `apps/xyne-claw` / `apps/xyne-claw-auth`
- [ ] `packages/shared` or another shared package
- [ ] Infra (docker, scripts, nix, CI)

---

## Zero (Sync) Changes

- [ ] No Zero changes — **skip this section**
- [ ] Adds/modifies a **mutator**
- [ ] Adds/modifies the **schema** (tables, columns, relationships)
- [ ] Adds/modifies a **query or ACL**

If any of the above:

- [ ] Server (`apps/backend/src/zero/mutators.ts`) and client (`apps/dashboard/src/zero/mutators.ts`) mutators mirror each other — same namespace, name, and args schema
- [ ] No `Date.now()` / `uuid()` generated inside a mutator
- [ ] Optimistic client result matches the server result (no state flash on rebase)
- [ ] New tables exported in `createSchema()` and given a Query ACL registered in `query-acl-factory.ts`
- [ ] Matching Prisma model + migration, client regenerated

## Schema & Data Changes

- [ ] No schema changes — **skip this section**
- [ ] Prisma schema modified (`apps/backend/prisma` and/or `prisma-common`)
- [ ] Migration added
- [ ] Backfill / data migration included

If any of the above:

- [ ] Clients regenerated (`db:generate`, `db:common:generate`)
- [ ] No new Postgres enum or enum value — enums are frozen (`pnpm run test:enum`)
- [ ] Backward compatible with deployed code, or rollout order noted below
- [ ] Backfill is idempotent

<!-- Rollout / rollback notes: -->

## Config, Environment & URLs

- [ ] No config changes — **skip this section**
- [ ] Env variable added / renamed / removed
- [ ] **Base URL, host, port, or origin changed** (API, Zero, Vespa, Claw, LiveKit, LiteLLM, …)
- [ ] CORS / allowed origins / OAuth redirect URIs changed
- [ ] Feature flag or runtime config changed

If any of the above:

- [ ] Key added to **all** relevant env files, not just the one you run — `apps/backend/.env.{example,local,test}`, `apps/dashboard/.env.{example,local,test}`, plus the app you touched
- [ ] Env setup / secret scripts and docker compose updated
- [ ] Verified in every consumer with its own base URL — dashboard (`VITE_API_BASE_URL`, `VITE_ZERO_SERVER`), Electron (`VITE_ELECTRON_*`), shareable links (`VITE_SHAREABLE_ORIGIN`), server-to-server (`BACKEND_URL`, `XYNE_CLAW_URL`, `XYNE_CLAW_AUTH_URL`)
- [ ] Google / Microsoft OAuth redirect URIs still resolve
- [ ] Nothing hardcoded, no secrets committed

<!-- Keys added/changed: -->

## API Contract

- [ ] No API changes
- [ ] New endpoint
- [ ] Existing contract modified (shape, status codes, auth)
- [ ] Breaking for dashboard / electron / external / bots — migration noted above

---

## How did you test it?
<!-- What you actually ran. Screenshots or a recording for UI changes. -->


### Automated

- [ ] Backend unit tests — `pnpm --filter xyne-spaces-backend run test`
- [ ] Claw tests — `pnpm --filter xyne-claw run test`
- [ ] End-to-end suite — `pnpm run test`
- [ ] Added / updated tests for this change
- [ ] Not covered by tests <!-- why? -->

### Manual

**Users**
- [ ] Single user
- [ ] Two users at once (two accounts / two browsers) — sync lands on both, no cross-user leakage
- [ ] Different roles or permission levels (member vs admin, ACL boundaries)
- [ ] Different workspaces / spaces — data stays scoped

**Login**
- [ ] Google
- [ ] Microsoft
- [ ] Dev auth (`ENABLE_DEV_AUTH`)
- [ ] Fresh signup / first-time user
- [ ] Session expiry, re-login, logout

**Run mode**
- [ ] Local dev (`pnpm run dev:all`)
- [ ] Test mode (`dev:test`)
- [ ] Sandbox / claw test (`claw:test`)
- [ ] Prod-like local (`dev:prod`)
- [ ] Docker compose
- [ ] Electron desktop

**Sync & resilience** — for anything touching Zero
- [ ] Multiple tabs stay consistent
- [ ] Reload / hard refresh — no duplicate or lost rows
- [ ] Offline then reconnect — pending mutations replay cleanly
- [ ] Concurrent edits on the same entity by two users

**Surface & data**
- [ ] Web browser
- [ ] Electron desktop
- [ ] Narrow viewport, dark + light theme
- [ ] Empty state
- [ ] Large / realistic data volume
- [ ] Error paths (network failure, denied permission, invalid input)

---

## Checklist

- [ ] Reviewed my own diff; scoped to one thing
- [ ] `pnpm run build:shared` passes
- [ ] Backend `typecheck` + `build` pass
- [ ] Dashboard `lint:errors-only` + `typecheck` + `build` pass
- [ ] Formatting clean in the packages I touched
- [ ] New deps added with `pnpm --filter <pkg> add <dep>`; version pins in root `pnpm.overrides`
- [ ] Commits follow `<type>: <TICKET-ID> <subject>`; branch is `fix/*` or `feature/*`
- [ ] Docs / guidelines updated where behaviour changed
- [ ] No debug logging or commented-out code left behind
