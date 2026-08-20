# Nix Development Environment

Xyne Spaces ships a [Nix](https://nixos.org/) flake so you can get a reproducible dev
shell and run the whole infrastructure layer without installing Node, pnpm, or the
service containers by hand.

This is an alternative to the pnpm + Docker path in
[Local Development](local-development.md). Nix owns the toolchain and the
infrastructure services; the app dev servers themselves still run under `pnpm` inside
the shell.

## When to use this

| You want to… | Use |
| ------------ | --- |
| A pinned Node/pnpm/just toolchain without touching your host | `nix develop` |
| Run Postgres, Redis, LiveKit and Zero-cache with one command | `nix run .#xyne-space-services` |
| The standard host-installed toolchain instead | [Local Development](local-development.md) |

## Prerequisites

- **Nix** with flakes enabled — the `nix-command` and `flakes` experimental features.
- A **container runtime** (podman or Docker). The services layer runs LiveKit and
  Zero-cache as containers; on non-NixOS hosts rootless podman needs `newuidmap` /
  `newgidmap` (the `uidmap` / `shadow-utils` package). See
  [`nix/containers/README.md`](../../nix/containers/README.md) for details.
- Optionally [direnv](https://direnv.net/) to auto-load the shell on `cd`.

## Enter the dev shell

```bash
nix develop
```

This drops you into a shell with **Node.js**, **pnpm**, and **just** on `PATH`
(defined in [`project.nix`](../../project.nix)) and prints a banner with the
getting-started commands.

With direnv you can skip the explicit `nix develop` — the repo's `.envrc` runs
`use flake` and also loads `apps/backend/.env.local` into the shell:

```bash
direnv allow
```

## Start the infrastructure services

```bash
nix run .#xyne-space-services   # or: just services
```

This starts, under a single `process-compose` supervisor, after first freeing the
relevant ports:

| Service | Port(s) |
| ------- | ------- |
| PostgreSQL (`wal_level=logical` for Zero CDC) | 5433 |
| Redis | 6379 |
| LiveKit | 7880 |
| Zero-cache | 4848 / 4849 |

A one-shot `db-setup` process runs once PostgreSQL is healthy: it pushes the Prisma
schema, seeds the ACL system, and creates the default admin user. If backend
dependencies are not installed yet it skips setup and tells you to run
`cd apps/backend && pnpm install` first.

## Run the apps

The app dev servers run under pnpm inside the shell:

```bash
just backend     # cd apps/backend && pnpm install && pnpm run dev
just dashboard   # cd apps/dashboard && pnpm install && pnpm run dev
```

Then open the dashboard at http://localhost:5173 and the backend API at
http://localhost:3001.

## Common commands

Run `just` (or `just --list`) to see everything. The most useful recipes:

| Command | What it does |
| ------- | ------------ |
| `just services` | Start all infrastructure services (`nix run .#xyne-space-services`) |
| `just backend` | Install deps and start the backend dev server |
| `just dashboard` | Install deps and start the dashboard dev server |
| `just migrate` | Push the Prisma schema (main + `prisma-common`) |
| `just prisma-generate` | Generate the Prisma clients |
| `just zero-permissions` | Deploy Zero permissions |
| `just assign-admin [EMAIL]` | Assign a user to the admin group (defaults to `DEFAULT_ADMIN_EMAIL`) |
| `just cleanup` | Free ports **and** wipe the database volumes (`nix run .#cleanup`) |
| `just cleanup-ports` | Free the service ports only, no data loss |
| `just reset` | Remove the local `./data` directory |

## Flake maintenance

| Command | What it does |
| ------- | ------------ |
| `just check` | `nix flake check` |
| `just update` | `nix flake update` |
| `just show` | `nix flake show` |

## Going deeper

- [`project.nix`](../../project.nix) — the single source of truth for the dev shell
  and every service. Edit this to change the Nix setup.
- [`nix/containers/README.md`](../../nix/containers/README.md) — the reusable module
  that runs pinned container images as process-compose processes.
- [`.plan/nixify.md`](../../.plan/nixify.md) — background on how and why the repo was
  nixified.
