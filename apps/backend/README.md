# Backend

The API server for Xyne Spaces — Express on Node 22 with Prisma and PostgreSQL.
Package name `xyne-spaces-backend`, served at **http://localhost:3001**.

## Running it

From the repository root, so pnpm resolves the workspace:

```bash
pnpm --filter xyne-spaces-backend run dev
```

The backend needs the infrastructure containers up — Postgres, Redis, and the rest. If
you have not started them, `pnpm run up` from the root does everything; see
[Local Development](../../docs/setup/local-development.md).

Two processes, run separately:

```bash
pnpm --filter xyne-spaces-backend run dev          # API server      (src/index.ts)
pnpm --filter xyne-spaces-backend run dev:worker   # background jobs (src/worker.ts)
```

`dev:all` at the root starts the API server, not the worker. Start the worker yourself
when you are working on ingestion, scheduled jobs, or anything queue-driven.

## Environment

Reads **`.env.local`**, not `.env` — every script wraps the process in
`dotenv -e .env.local`. Create it and fill the secrets from the repository root:

```bash
pnpm run env:setup    # copies .env.example → .env.local, never overwrites
pnpm run secrets      # replaces the `set-me` placeholders
```

`JWT_SECRET` must be a real value. Joi requires it at config load
(`src/config/env.ts`), and a short one — `set-me` included — is rejected by the JWT
services with `JWT_SECRET environment variable is required and must be at least 32
characters`. AI features need a provider on top of this — see
[AI Providers](../../docs/setup/ai-providers.md).

## Databases

Two Prisma schemas, in separate Postgres instances:

| Schema | Database | Port | Holds |
| ------ | -------- | ---- | ----- |
| `prisma/schema.prisma` | `xyne_dev_db` | 5433 | Application data |
| `prisma-common/schema.prisma` | `xyne_common` | 5434 | Shared reference data |

```bash
pnpm --filter xyne-spaces-backend run db:generate         # regenerate the app client
pnpm --filter xyne-spaces-backend run db:common:generate  # regenerate the common client
pnpm --filter xyne-spaces-backend run db:push             # push schema without a migration
pnpm --filter xyne-spaces-backend run db:migrate          # create a migration
pnpm --filter xyne-spaces-backend run db:studio           # browse data
```

> **`pnpm install` does not generate the Prisma clients.** A fresh clone or a wiped
> `node_modules` leaves them missing, and the server fails at import with
> `Cannot find module '.../prisma-common/generated/client'`. Run both `db:generate`
> commands, or `pnpm run services`, which does it for you.

Generating the app schema also emits the **Zero** schema into `prisma/generated/zero`,
which the dashboard imports. Run `db:generate` after any schema change — the generated
output is an input to typecheck, so a stale one surfaces as confusing type errors rather
than a clear message.

## Layout

```
src/
├── index.ts        # API server entry point
├── worker.ts       # Background worker entry point
├── app.ts          # Express app assembly — middleware and route mounting
├── routes/         # Route definitions, mounted under /api/*
├── controllers/    # Request handling
├── services/       # Business logic — the bulk of the codebase
├── database/       # Prisma clients and repositories
├── middleware/     # Auth, rate limiting, error handling, tracing
├── validators/     # Joi request schemas
├── queues/         # Bull queues on Redis
├── workers/        # Queue consumers and scheduled jobs
├── zero/           # Zero sync permissions and mutators
├── vespa/          # Search client and query building
├── pubsub/         # Event fan-out
├── integrations/   # Google, Slack, desk, and other third-party integrations
├── agents/         # Agent orchestration surfaces
├── automations/    # Rule-driven automations
├── notification-service/  # Push, email, and in-app notifications
├── bots/           # Built-in bots (automations, release, Bitbucket)
├── config/         # Env parsing and typed config
├── types/          # Shared TypeScript types
└── utils/          # Helpers
```

Routes mount under `/api/*` in `src/app.ts`. Health checks are the ones to hit when
verifying the process is alive:

```
GET /api/health             # general status
GET /api/health/readiness   # readiness probe
GET /api/health/liveness    # liveness probe
```

The full REST surface is in [API_DOCUMENTATION.md](../../API_DOCUMENTATION.md).

## Checks

```bash
export NODE_OPTIONS="--max-old-space-size=8192"   # typecheck needs more than the default heap

pnpm --filter xyne-spaces-backend run typecheck   # tsc --noEmit
pnpm --filter xyne-spaces-backend run build       # tsc
pnpm --filter xyne-spaces-backend run lint
pnpm --filter xyne-spaces-backend run test        # Jest — jest.config.cjs
```

The pre-commit hook runs `typecheck` and `build` when files here change.

Tests live in `tests/integration/` (integration, hitting a running stack) and
`src/test/` (unit, beside the code).

## Docker

`Dockerfile` builds the production image; `Dockerfile.test` is the CI test image. For
local work use `pnpm run services` instead — it runs the dependencies in containers and
leaves the backend on the host, so you keep hot reload.

## See also

- [Local Development](../../docs/setup/local-development.md) — setup, database work, dependency rules
- [AI Providers](../../docs/setup/ai-providers.md) — required for the AI features to respond
- [Services](../../docs/setup/services.md) — what each container does and its port
- [Troubleshooting](../../docs/setup/troubleshooting.md)
- [Dashboard README](../dashboard/README.md) — the client consuming this API
- [API Documentation](../../API_DOCUMENTATION.md) — REST reference

Licensed under the repository [LICENSE](../../LICENSE).
