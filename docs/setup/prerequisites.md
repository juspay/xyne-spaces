# Prerequisites

## Required

| Tool | Version | Notes |
| ---- | ------- | ----- |
| **Node.js** | 22.x | CI pins Node 22; other majors are untested |
| **pnpm** | 10.15.0 | Pinned via `packageManager` in the root `package.json` |
| **Docker** | 20.10+ with Compose v2 | Podman with `podman-compose` also works |
| **Git** | 2.30+ | |

Everything else — Prisma, TypeScript, Vite — is installed by `pnpm install`.

## Installing pnpm

The repository pins pnpm through the `packageManager` field, so Corepack will select
the right version automatically:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

If Corepack cannot write to your Node installation (common when Node lives under
`/usr` and you are not root), install into a user-writable prefix instead:

```bash
npm install -g --prefix "$HOME/.local" pnpm@10.15.0
export PATH="$HOME/.local/bin:$PATH"
```

Verify:

```bash
node --version    # v22.x
pnpm --version    # 10.15.0
```

> **Do not use `npm install` in this repository.** It is a pnpm workspace with a
> single `pnpm-lock.yaml`. Running npm will produce a conflicting `node_modules`
> and a stray `package-lock.json`.

## Container runtime

Any of these work — the scripts detect what is available:

- **Docker Desktop** or **OrbStack** (macOS)
- **Docker Engine** with the Compose plugin (Linux)
- **Podman** with `podman-compose`

**Start it before you run anything.** Installed is not the same as running — Docker
Desktop and OrbStack must actually be launched, and the daemon has to be up on Linux.
`pnpm run services` stops immediately if it cannot find a live runtime:

```
❌ No container runtime available. Please start Docker/OrbStack or install Podman.
```

Allocate at least **8 GB of memory** (and ~20 GB of disk) to the container runtime. The
infrastructure stack runs Postgres (×3), Redis, LiveKit, MinIO, Y-Sweet, Zero, Vespa,
and an OpenTelemetry collector concurrently, and Vespa downloads an embedding model on
its first run.


## Platform notes

**macOS (Apple Silicon)** — native modules such as `canvas` and `@napi-rs/canvas`
resolve to arm64 builds. If you previously installed with a different architecture,
clear the store: `pnpm store prune`.

**Linux** — install build dependencies for native modules:

```bash
sudo apt-get install -y python3 make g++ libcairo2-dev libpango1.0-dev \
                        libjpeg-dev libgif-dev librsvg2-dev libssl-dev
```

**Windows** — use WSL2. `pnpm run services:win` exists for the Windows-native path
but is less exercised than the macOS and Linux flows.

## Next

→ [Local Development](local-development.md)
