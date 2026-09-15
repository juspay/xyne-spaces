# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Xyne Spaces is a pnpm monorepo for an "org OS": connectors normalize an organization's
data (Slack, Google Workspace, M365, Jira, Confluence) into PostgreSQL + Vespa, and a set
of collaborative apps (Chat, Tickets, Canvas, Call, Claw agents, Agentic Search) read and
write through that one store. The defining constraint is that **access control is enforced
at the data layer, not per feature** — reads are scoped to the acting user, writes go
through the same permission layer, and agents inherit the invoking user's access with no
privileged bypass.

Node 22.x, pnpm 10.15.0, TypeScript throughout. Workspace members are listed explicitly in
`pnpm-workspace.yaml` (not globbed) so a stray `npm install` cannot silently become one.

## Commands

### Setup and dev

```bash
pnpm run up                  # full bootstrap: env files → install → secrets → services → dev TUI
pnpm run dev                 # interactive app picker, one pane per app (restart a pane with `r`)
XYNE_DEV_APPS=all pnpm run dev   # skip the picker
pnpm run bootstrap:raw       # non-interactive bootstrap + all apps, for scripted runs
pnpm run services            # infra containers + migrations + seed only
pnpm run services:stop
pnpm run validate            # Xyne Doctor health check
pnpm run reset               # reset local environment
```

Local URLs: dashboard 5173, backend API 3001, Claw 3002, Claw Auth 3003. Local login is
`admin@xyne.ai` / `xynelocal@123`.

Bootstrap phases run serially, stop at first failure, and are each idempotent — re-run a
single phase (`pnpm run env:setup`, `secrets`, `services`) rather than the whole thing.

### Verify before pushing

This is the set CI runs. Both builds need more than Node's default heap:

```bash
export NODE_OPTIONS="--max-old-space-size=8192"

pnpm run build:shared
pnpm --filter xyne-spaces-backend   run typecheck
pnpm --filter xyne-spaces-backend   run build
pnpm --filter xyne-spaces-dashboard run lint:errors-only
pnpm --filter xyne-spaces-dashboard run typecheck
pnpm --filter xyne-spaces-dashboard run build
pnpm --filter agentic-framework     run lint
pnpm --filter xyne-claw             run typecheck
```

`pnpm --filter xyne-spaces-dashboard run validate` bundles typecheck + format check + lint.

### Tests

```bash
pnpm --filter xyne-spaces-backend run test                    # Jest
pnpm --filter xyne-spaces-backend exec jest src/path/to/x.test.ts   # one file
pnpm --filter xyne-spaces-backend exec jest -t "test name"          # one test by name
pnpm --filter xyne-claw run test                              # Vitest
pnpm --filter xyne-claw exec vitest run src/path/to/x.test.ts
pnpm --filter @xyne/shared run test                           # tsc + node --test
pnpm run test                                                 # Playwright + Cucumber E2E (tools/xyne-automation)
pnpm perf:validate                                            # offline k6 framework check, sends no traffic
```

Backend Jest: `roots: src/`, so tests live beside source as `*.test.ts` / `*.spec.ts` or in
`__tests__/`. `@/` maps to `src/`.

### Prisma

Two schemas. If you touch either, regenerate — the generated client is an input to
typecheck, and a stale one surfaces as confusing type errors:

```bash
pnpm --filter xyne-spaces-backend run db:generate          # prisma/schema.prisma
pnpm --filter xyne-spaces-backend run db:common:generate   # prisma-common/schema.prisma
pnpm --filter xyne-spaces-backend run db:push              # and db:studio, db:migrate
```

`Makefile` targets (`build-backend`, `push-dashboard`, `build-all`, …) are for container
image build/push, not local development.

## Architecture

### Zero sync is the data path — and it is a three-file contract

Reads and writes from the client go through **Zero** (Rocicorp), a local-first sync engine,
not through REST. The REST API in `apps/backend/src/api` and `routes/` exists alongside it
for integrations, auth, and non-synced work.

Zero definitions are **duplicated on purpose** and must be kept in lockstep:

| Piece | Location | Rule |
| --- | --- | --- |
| Schema | `packages/shared/src/zero/schema.ts` | single source of truth; must mirror `schema.prisma` |
| Queries | `apps/backend/src/zero/queries.ts` + `apps/dashboard/src/zero/queries.ts` | must be **identical** |
| Mutators | `apps/backend/src/zero/mutators.ts` + `apps/dashboard/src/zero/mutators.ts` | mirror each other, but differ in kind |
| Query ACLs (read) | `packages/shared/src/zero/acl/` | applied automatically by `defineQuery()` |
| Mutation ACLs (write) | `apps/backend/src/zero/acl/` | applied by `wrapMutatorsWithACL()` |

Changing a query or mutator in one place and not the other is the most common way to break
this repo. Server mutators perform the real database work; client mutators exist to produce
the **optimistic** update, which is why they must be deterministic.

Server entry point is `apps/backend/src/zero/server.ts`:

```
mutate:  Request → JWT auth → rate limit → ACL wrap → mutator → Vespa jobs → side effects
query:   Request → JWT auth → rate limit → query with context → result
```

Don't bypass the ACL wrappers, and don't edit `server.ts` without reading the whole flow.

### Tenant scoping is applied centrally, not per query

`apps/backend/src/zero/tenant-scope.ts` scopes every query's root table to the caller's
workspace (or organisation, for the few tables above workspaces) rather than trusting each
query definition to include the filter. A table that is neither workspace- nor org-scoped
must be declared global reference data; **an unlisted table is refused rather than served
unscoped**. Per-table read ACLs live as ~129 files in `packages/shared/src/zero/acl/tables/`.

### Backend is strictly layered

```
Request → Routes → Controllers → Services → Repositories → Prisma
              ↑ Middleware (auth, validation, rate limiting)
```

Each layer calls only the one directly below it. Controller → repository is forbidden.
Services may call other services. Env vars are Joi-validated at startup in
`src/config/env.ts`; read them via `import { config } from '@/config/env'`, never
`process.env` directly. Throw `AppError` from `src/middleware/errorHandler.ts`.

Background work is BullMQ: `src/queues/` defines jobs, `src/workers/` processes them,
`src/workflows/` and `workflowsV2/` orchestrate multi-step flows. The worker is a separate
process (`src/worker.ts`, `pnpm --filter xyne-spaces-backend dev:worker`).

Connectors in `src/integrations/` are adapters behind one contract — resolve,
authenticate, transform, sync — and everything downstream is shared, so adding a platform
means writing an adapter, not touching the pipeline. See
`apps/backend/src/integrations/README.md`.

### The agent plane is a three-tier security split

The split *is* the security model: **the tier that runs untrusted code holds no secrets,
and the tier that holds every secret runs no untrusted code.**

- `apps/xyne-claw-auth/` — the gateway. Verifies the HMAC-signed webhook from Spaces,
  resolves agents and credentials, and executes *every* external tool call itself via
  `/mcp/call`. Owns Postgres (agents, credentials), Redis/BullMQ (schedules, run recovery),
  GCS (session checkpoints). Brokers 50+ MCP integrations, configured per user.
- `apps/xyne-claw/` — the runtime. Runs the LLM agent loop and path-scoped filesystem
  tools. No secrets, no shell. It posts a tool name plus parameters back to the gateway with
  a short-lived HMAC session token and receives only the result.
- Kata Containers QEMU microVM — anything needing a real shell, driven by the gateway via
  `sandbox-*` calls, **egress closed**. Setup in `apps/xyne-claw/infra/kata/`.

Read tools run freely. Tools that act *as the user* (create a ticket, send a message) post
an approve/decline card and wait for a click. The distinction is identity, not danger.

### Dashboard

React 19 + Vite + Tailwind + Radix. Server state via Zero and `@tanstack/react-query`;
complex local state via XState machines in `src/machines/`. Collaborative editing is Yjs /
y-sweet with BlockNote/TipTap. Components that consume `@xyne/shared` Context must use
`useAuthContextValues`.

## Enforced invariants

These are guards, not advice — each blocks a commit or a CI run. Knowing *why* they exist
saves fighting them.

| Guard | Rule |
| --- | --- |
| `scripts/validate-no-new-enums.sh` | **Postgres enums are frozen.** No new enum, no new value in an existing one, no `CREATE TYPE`/`ALTER TYPE` in a migration. A new value must be a plain `String` column plus app-side validation, with zero DB migration. (`DROP TYPE` is allowed.) |
| `scripts/validate-workspace-id.sh` | A **brand new** Prisma model needs a non-nullable `workspaceId` or `orgId`. Repositories and the ACL extension key off it, so a table that never had the column can never be scoped later. Opt out via `// workspace-check:ignore` above the model or `TENANT_KEY_EXCLUDED_MODELS` in `apps/backend/src/database/tenant/tenant-key-exclusions.ts` — which silences the shape check only, not the ACL requirement. |
| No-Default-ACL guard (same script) | Every model needs an explicit, reviewed access decision: a real scoped ACL or `UnscopedACL`. |
| `scripts/validate-zero-column-parity.mjs` | A column in the shared Zero schema that is absent from `schema.prisma` is blocked. |
| `scripts/validate-schema-migrations.sh` | Schema changes must come with a migration. |
| gitleaks (pre-commit + CI) | Install it — `brew install gitleaks` — or the hook warns and skips, letting a secret through locally. For a genuinely safe value, add it to `.gitleaks.toml` under `[allowlist]` rather than bypassing; the allowlist diff is visible in review, which is the point. |

Custom ESLint rules in `apps/dashboard/eslint-rules/` enforce the Zero contract mechanically:

- `no-rocicorp-use-query` / `no-rocicorp-use-zero` — import `useQuery`/`useZero` from the
  project's own measured hooks (`src/hooks/`), never from `@rocicorp/zero/react`.
- `no-date-now-or-uuid-in-mutators` — generate UUIDs and timestamps in the **caller** and
  pass them as parameters. A mutator that generates its own produces a different result on
  client and server, so the optimistic update diverges from the committed row.
- `no-fetch-use-axios`, `no-direct-message-lookup-in-mutators`,
  `require-initial-message-md-in-conversation-insert`, `require-tracking-on-click`.

Keep client mutators lightweight and side-effect free — no network calls, no heavy
computation. Real work belongs in the server mutator or a queued job.

## Conventions

**Dependencies.** pnpm's isolated linker only exposes declared dependencies, so an import
that resolves locally because something else pulls it in will break for everyone else.
Always add with a filter:

```bash
pnpm --filter xyne-spaces-backend add express
```

Version pins live in `pnpm.overrides` in the **root** `package.json`; a pin inside an
individual package is ignored.

**Branches.** `fix/<desc>` or `feature/<desc>` — the pre-push hook rejects anything else.
Names ending `-test-reports` are reserved for the automated report flow and blocked.

**Commits.** commitlint requires a ticket reference:

```
<type>: <TICKET-ID> <subject>
```

e.g. `fix: XYNE-1234 reset ticket filters when the space changes`. Type is one of `feat`,
`feature`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`,
`revert`. Ticket is `XYNE-1234` or any `PROJECT-1234`; the commit is rejected without one.
Header under 200 chars. `pnpm exec cz` walks through it interactively.

The pre-commit hook runs only what you touched (backend typecheck+build, dashboard
lint+validate, framework lint, automation validate, `perf:validate`), so it is slow on a
large diff by design — it is the same set CI runs.

**Docs are part of the change.** If a change alters setup, ports, env vars, or commands,
update `docs/setup/` and the README in the same PR.

**Style.** Prettier: semicolons, single quotes (including JSX), trailing commas, width 100,
2-space indent. `any` is an error in the dashboard, a warning in backend/framework. Strict
equality, braces on all control statements, `prefer-const`, `_` prefix for intentionally
unused vars and private members. Enum members and constants `UPPER_CASE`. Use `zod` for
runtime validation. Prefer matching the file you are editing over introducing a new style.

## Deeper documentation

| | |
| --- | --- |
| `apps/backend/docs/guidelines/` | Backend structure, AUTH, JOBS, SERVICES, WORKFLOWS, INTEGRATIONS, and `zero/` (overview, schema, queries, mutators) |
| `apps/dashboard/docs/guidelines/` | Dashboard structure, contexts, hooks, machines, providers, services, `ui/`, and `zero/` |
| `guidelines/AGENTS.md` | Repo-wide code style for coding agents (partly stale on paths — trust `pnpm-workspace.yaml`) |
| `docs/setup/` | Prerequisites, local setup, services, AI providers, troubleshooting, Xyne Doctor |
| `API_DOCUMENTATION.md` | REST API reference |
| `apps/xyne-claw-auth/docs/mcp-gateway-integration.md` | MCP gateway integration |
| `performance/README.md` | k6 performance framework; routine runs accept only `sandbox` and `preprod` — production is deliberately rejected |
