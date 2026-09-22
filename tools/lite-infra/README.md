# lite-infra

Runs the core infrastructure for local development as plain processes, with no
Docker, Podman, or Nix, then starts the apps in the same terminal. From the repo root:

```sh
pnpm run up:lite
```

That is the container-free equivalent of `pnpm run up`: it brings up Postgres, Redis,
fake-gcs and zero-cache, seeds the database on first run, then hands the terminal to
the same app picker `pnpm run dev` uses (the mprocs TUI, or `concurrently` with
`--plain`). Quitting the apps (`q` in the TUI, or Ctrl+C) stops the core services too.

| Service       | How it runs                                                        | Port |
|---------------|--------------------------------------------------------------------|------|
| PostgreSQL 16 | `embedded-postgres` npm package (binaries fetched once, ~30 MB)    | 5433 |
| Redis         | your system `redis-server` (or `valkey-server`)                    | 6379 |
| fake-gcs      | `fake-gcs-server` release binary (fetched once into `bin/`, ~10 MB)| 4443 |
| zero-cache    | `@rocicorp/zero`, the same version the backend uses                | 4848 |

Same users, passwords, database names, buckets, ports, and Postgres settings as
`docker-compose.dev.yml` and `docker/init-db.sh`, so `apps/backend/.env.local`
works unchanged. Footprint is roughly 400 MB of binaries plus a few hundred MB of
RAM, instead of a VM and several GB of images.

Not covered, and opt-in in the container setup too: Vespa search, LiveKit calls,
transcription, call recording, Superposition, observability. There is also no S3
server; the backend default `STORAGE_PROVIDER=gcs` uses fake-gcs.

## Prerequisites

- `pnpm install` done at the repo root (it installs this package too)
- `redis-server` on PATH: `brew install redis` on macOS, `sudo apt install redis-server` on Debian/Ubuntu

## What `up:lite` does

1. Refuses to start if any of the four ports is taken (typically the Docker stack:
   run `pnpm run services:stop` first).
2. Starts Postgres with `wal_level=logical`, creates the `claw` role and the
   `xyne_dev_db`, `xyne_common`, `claw_auth_db` databases.
3. Starts Redis and fake-gcs, creates the five buckets `start-services.sh` creates.
4. On a fresh database, runs the same schema push and seeds `start-services.sh`
   runs (`prisma db push` for both schemas, `seed-acl`, `assign-user-group`,
   `seed-app-permissions`, `demo-seed`). Two to three minutes the first time.
5. Starts zero-cache, reading `ZERO_AUTH_SECRET` and other `ZERO_*` values from
   `apps/backend/.env.local`, the same way the compose file does.
6. Runs `scripts/dev-interactive.mjs` with the terminal, so the app picker, port
   checks, and TUI behave exactly as with `pnpm run dev`. When it exits, the core
   services are stopped in order and Postgres gets a clean shutdown.

Service output is not mixed into the terminal: each service writes to
`tools/lite-infra/data/logs/<service>.log` (set `LITE_VERBOSE=1` to echo it as well).
Data persists in `tools/lite-infra/data` (gitignored).

## Scripts (repo root)

| Command | What it does |
|---------|--------------|
| `pnpm run up:lite` | Core services + apps. Flags after `--`: `--infra-only` (no apps, Ctrl+C to stop), `--setup` (re-run schema push + seeds), `--no-demo` (skip sample data); `--all` and `--plain` are passed to the app runner. `XYNE_DEV_APPS=backend,dashboard` pre-selects apps. |
| `pnpm run down:lite` | Stop services left running (e.g. a closed terminal). |
| `pnpm run status:lite` | Show which of the four services answer. |
| `pnpm run reset:lite` | Stop everything and delete `tools/lite-infra/data` (fresh database next time). |
| `pnpm run cleanup:lite` | Stop everything and delete `tools/lite-infra/data` and `tools/lite-infra/bin`, i.e. everything `up:lite` created on this machine. The lite counterpart of `pnpm run cleanup`. |

`pnpm --filter xyne-lite-infra db-setup` re-runs the schema push + seeds on their own.

## Notes

- The schema/seed step pins `DATABASE_URL`, `COMMON_DATABASE_URL`, `REDIS_URL`
  and `FAKE_GCS_HOST` to the embedded services regardless of `.env.local`, so it
  can never reach another database.
- Ports can be moved with `PG_PORT`, `REDIS_PORT`, `GCS_PORT`, `ZERO_PORT`, and the
  data directory with `LITE_DATA`; then update the matching URLs in `.env.local`.
- pnpm 10 blocks post-install scripts by default. The root `package.json`
  allow-lists `@embedded-postgres/<platform>` (creates symlinks the Postgres
  binaries need) and `@rocicorp/zero-sqlite3` (native sqlite for zero-cache).
