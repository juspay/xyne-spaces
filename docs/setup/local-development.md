# Local Development

A first run from a clean clone. Assumes you have already worked through
[Prerequisites](prerequisites.md) — and if the machine has nothing installed at
all, start with [Local Setup](local-setup.md) instead.

## The one-command path

If you just want a running environment, this does every step on this page in order:

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm run up
```

`pnpm run up` (same as `pnpm run bootstrap`) runs in two stages:

```
Stage 1 (supervised by Xyne Doctor):  env:setup → setup (install + build:shared) → secrets → services
Stage 2 (interactive):                app picker → multi-pane process TUI
```

The steps run serially and the chain stops at the first failure, so a broken step is
never masked by a later one. Every step is idempotent — env files and real secrets are
never overwritten — so it is safe to re-run on an existing checkout.

Along the way it asks which **infrastructure features** you need (fewer features,
fewer containers), which **apps** you want to run, and it checks the ports each
choice needs are actually free before starting anything — naming the process that
holds a busy port instead of letting six processes race to an `EADDRINUSE`.

Stage 1 runs through [Xyne Doctor](xyne-doctor.md). On a real nonzero exit it can
prepare redacted context and hand the failure to Claude Code or Codex; Ctrl-C and
non-interactive runs keep their normal exit behavior. Stage 2 runs outside the
doctor — a full-screen TUI cannot render into its captured pipe.

Fully non-interactive equivalent (CI, scripts): `pnpm run bootstrap:raw` — no
prompts, no TUI, plain interleaved logs.

Expect a few minutes on the first run while container images download. When it
finishes, open **http://localhost:5173**.

The rest of this page walks through the same steps individually. Read on if you want
to understand what each one does, need to run only part of the setup, or are debugging
a step that failed.

## 1. Clone and install

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm install
```

One install covers all 21 workspace packages. There is no per-package install step —
if you find yourself running `pnpm install` inside `apps/backend`, something is wrong.

## 2. Environment files

Each app ships an `.env.example`. Copy all four at once:

```bash
pnpm run env:setup
```

That never overwrites an existing file, so it is safe to re-run. The equivalent by
hand, if you only want some of them:

```bash
cp apps/backend/.env.example              apps/backend/.env.local
cp apps/dashboard/.env.example            apps/dashboard/.env.local
cp apps/xyne-claw/.env.example            apps/xyne-claw/.env
cp apps/xyne-claw-auth/backend/.env.example  apps/xyne-claw-auth/backend/.env
```

The backend reads `.env.local` (via `dotenv -e .env.local`), while `xyne-claw` and
`claw-auth` read `.env` (via `tsx --env-file=.env`). This asymmetry is deliberate —
copy to the filename shown above.

### Generate local secrets

`apps/backend/.env.example` ships several secrets as the literal placeholder `set-me`.
The backend refuses to boot on those — `JWT_SECRET` is validated at startup and throws
`JWT_SECRET environment variable is required and must be at least 32 characters`.

Fill them in:

```bash
pnpm run secrets
```

This generates `JWT_SECRET`, `ZERO_AUTH_SECRET`, and `ENCRYPTION_KEY`, writing
them into `apps/backend/.env.local`.

`pnpm run services` runs this for you, so a normal setup never needs it explicitly.
Reach for it directly when you copied `.env.local` by hand, or when a `.env.local`
from an older checkout still has `set-me` values in it.

Safe to re-run at any time: it only replaces placeholder or empty values, so real
secrets you have added are never overwritten.

## 3. Build the shared libraries

```bash
pnpm run build:shared
```

This compiles `@xyne/shared`, `@xyne/icons`, `agentic-framework`, and
`@xyne/litellm-client`. **Do this before anything else** — the applications import
these from their built `dist/`, so a missing build shows up as unresolved-import
errors rather than a clear message.

Re-run it whenever you change code in `packages/shared`, `packages/icons`, or
`packages/framework`, or `packages/litellm-client`. For an ongoing loop, watch
instead:

```bash
pnpm --filter @xyne/shared run watch
```

## 4. Start infrastructure

```bash
pnpm run services
```

This first asks whether to **reuse existing data or start fresh** — fresh wipes
this checkout's containers, volumes, and databases via `pnpm run reset` (with a
confirmation, since it deletes every local database and bucket). Then it asks
which features you need — *Chat & Tickets* (Postgres, Redis, Zero, MinIO) is
always on; Calls, Canvas, Search, Transcription, Observability, and Feature
Flags are opt-in, and each unselected feature is a container that never starts. Pick **Everything**, **Core**, or select individually; your answer is
remembered for next time. It then checks the required host ports are free (naming
whatever process holds a busy one), brings the containers up, waits for health
checks, applies Prisma migrations, and seeds baseline data. Expect a few minutes
on the first run while images download.

Scripted runs skip the prompt: `XYNE_FEATURES=1,4,7 pnpm run services` starts
Chat & Tickets, Calls, and Search directly (the numbers match the picker's order).

See [Services](services.md) for what each container does and which port it uses.

Stop everything with:

```bash
pnpm run services:stop
```

## 5. Run the apps

```bash
pnpm run dev
```

This asks which apps to run — **Everything**, **Core** (backend, worker,
dashboard), your previous selection, or a custom pick — then opens them in a
multi-pane terminal UI ([mprocs](https://github.com/pvolok/mprocs)): a process
list on the left, one isolated pane per process on the right.

| Key | Action |
| --- | ------ |
| `↑` / `↓` | switch between processes |
| `r` | restart just that process |
| `x` / `s` | stop / start it |
| `z` | zoom the pane full-screen |
| `Ctrl-a` | type into the process (again to leave) |
| `q` | quit and stop everything |

Busy dev ports are detected before launch, with an offer to stop whatever stale
process is holding them.

Other ways to run:

```bash
XYNE_DEV_APPS=backend,dashboard pnpm run dev   # no prompt, just these two
XYNE_DEV_APPS=all pnpm run dev                 # no prompt, everything
pnpm run dev:all:plain                         # old behaviour: one stream, interleaved logs
pnpm --filter xyne-spaces-backend   run dev    # single app, plain terminal · http://localhost:3001
pnpm --filter xyne-spaces-dashboard run dev    # http://localhost:5173
```

Open **http://localhost:5173**.

## 6. Turn the AI on

Everything above gets you a working workspace — chat, tickets, calls, and documents.
The AI features stay silent until you point the apps at an OpenAI-compatible endpoint,
and they fail without an error in the UI, so this step is easy to miss.

→ [AI Providers](ai-providers.md)

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

→ [AI Providers](ai-providers.md) · [Services](services.md) · [Troubleshooting](troubleshooting.md)
