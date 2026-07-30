# Local Development

A first run from a clean clone. Assumes you have already worked through
[Prerequisites](prerequisites.md).

## 1. Clone and install

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm install
```

One install covers all 20 workspace packages. There is no per-package install step —
if you find yourself running `pnpm install` inside `apps/backend`, something is wrong.

## 2. Environment files

Each app ships an `.env.example`. Copy the ones you need:

```bash
cp apps/backend/.env.example              apps/backend/.env.local
cp apps/dashboard/.env.example            apps/dashboard/.env.local
cp apps/xyne-claw/.env.example            apps/xyne-claw/.env
cp apps/xyne-claw-auth/backend/.env.example  apps/xyne-claw-auth/backend/.env
```

The backend reads `.env.local` (via `dotenv -e .env.local`), while `xyne-claw` and
`claw-auth` read `.env` (via `tsx --env-file=.env`). This asymmetry is deliberate —
copy to the filename shown above.

Local secrets that need generating (VAPID keys for web push, etc.) are filled in by
`scripts/start-services.sh` on first run; it only replaces placeholder values, so
real secrets you add are never overwritten.

## 3. Build the shared libraries

```bash
pnpm run build:shared
```

This compiles `@xyne/shared`, `@xyne/icons`, and `agentic-framework`. **Do this before
anything else** — the backend and dashboard import these from their built `dist/`, so
a missing build shows up as unresolved-import errors rather than a clear message.

Re-run it whenever you change code in `packages/shared`, `packages/icons`, or
`packages/framework`. For an ongoing loop, watch instead:

```bash
pnpm --filter @xyne/shared run watch
```

## 4. Start infrastructure

```bash
pnpm run services
```

This brings up Postgres, Redis, LiveKit, MinIO, Y-Sweet, Zero, and observability
containers, waits for health checks, applies Prisma migrations, and seeds baseline
data. Expect a few minutes on the first run while images download.

See [Services](services.md) for what each container does and which port it uses.

Stop everything with:

```bash
pnpm run services:stop
```

## 5. Run the apps

All four at once, with colour-coded interleaved logs:

```bash
pnpm run dev:all
```

Or individually, in separate terminals:

```bash
pnpm --filter xyne-spaces-backend   run dev    # http://localhost:3001
pnpm --filter xyne-spaces-dashboard run dev    # http://localhost:5173
pnpm --filter xyne-claw             run dev
pnpm --filter xyne-claw-auth        run dev
```

Open **http://localhost:5173**.

## Database work

Prisma schemas live in `apps/backend/prisma` (application) and
`apps/backend/prisma-common` (shared reference data).

```bash
pnpm --filter xyne-spaces-backend run db:generate         # regenerate client
pnpm --filter xyne-spaces-backend run db:common:generate  # regenerate common client
pnpm --filter xyne-spaces-backend run db:push             # push schema without a migration
pnpm --filter xyne-spaces-backend run db:migrate          # create a migration
pnpm --filter xyne-spaces-backend run db:studio           # browse data
```

Run `db:generate` after any schema change — the generated client is an input to
typecheck, so stale output surfaces as confusing type errors.

## Verifying your changes

What CI runs, so you can run it first:

```bash
pnpm run build:shared
pnpm --filter xyne-spaces-backend   run typecheck
pnpm --filter xyne-spaces-backend   run build
pnpm --filter xyne-spaces-dashboard run lint:errors-only
pnpm --filter xyne-spaces-dashboard run typecheck
pnpm --filter xyne-spaces-dashboard run build
pnpm --filter agentic-framework     run lint
```

Set `NODE_OPTIONS="--max-old-space-size=8192"` first — the backend typecheck and the
dashboard build both need more than Node's default heap.

## Adding a dependency

Always target a package explicitly; a bare `pnpm add` at the root adds to the root
project, which is almost never what you want:

```bash
pnpm --filter xyne-spaces-backend add express
pnpm --filter xyne-spaces-dashboard add -D @types/node
```

To depend on another workspace package, use the `workspace:` protocol:

```bash
pnpm --filter xyne-spaces-backend add @xyne/shared@workspace:*
```

**Declare what you import.** pnpm's isolated linker only exposes a package's declared
dependencies. An import that resolves for a colleague because something else happens
to pull it in will fail here — and version pins live in `pnpm.overrides` at the root,
so add security pins there rather than in individual packages, where they are ignored.

## Next

→ [Services](services.md) · [Troubleshooting](troubleshooting.md)
