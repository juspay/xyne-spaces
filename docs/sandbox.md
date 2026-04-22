# Xyne Spaces Multi-Sandbox System

## Overview
Multi-sandbox system for parallel development. Each sandbox gets its own backend, dashboard, zero cache, git worktree, and logical Postgres DB. Shared infrastructure like Redis, LiveKit, Traefik, and GCS is common across sandboxes. It's designed for AI agents working in parallel but usable by humans too.

## Prerequisites
- Docker Desktop running
- Node.js >= 18
- Git
- Port 80 free (Traefik)
- All code changes committed to the current branch (worktrees are created from HEAD)

## Quick Start
```bash
npm run sandbox -- create my-sandbox
# → opens at http://my-sandbox.localhost
# → auto-logged in as sandbox@xyne.ai (admin)

npm run sandbox -- destroy my-sandbox
```

## Commands Reference
| Command | Description |
| :--- | :--- |
| `npm run sandbox -- create <name>` | Create new sandbox (~2min with cached images, ~7min first time) |
| `npm run sandbox -- stop <name>` | Stop containers (preserves data, DB, worktree) |
| `npm run sandbox -- start <name>` | Restart a stopped sandbox |
| `npm run sandbox -- destroy <name>` | Remove everything: containers, volumes, DB, worktree, branch |
| `npm run sandbox -- list` | List all sandboxes with status |
| `npm run sandbox -- logs <name> [service]` | Tail logs. Services: backend, dashboard, zero-cache |
| `npm run sandbox -- status <name>` | Show container status, DB, URLs, git info |
| `npm run sandbox -- exec <name> [backend\|dashboard] <cmd>` | Run command inside container. Default service: backend |
| `npm run sandbox -- infra up\|down` | Start/stop shared infrastructure |
| `npm run sandbox -- build-images` | Force rebuild base Docker images |

## What `create` Does
1. Starts shared infrastructure if not running (Traefik, Postgres, Redis, LiveKit, etc.)
2. Builds base Docker images if not cached (hashes lockfiles + Dockerfiles)
3. Creates git worktree at `.sandboxes/<name>` on branch `sandbox/<name>`
4. Creates logical Postgres database `sandbox_<name>_db`
5. Builds shared + framework modules in the worktree
6. Generates per-sandbox docker-compose.yml
7. Starts containers (backend, dashboard, zero-cache)
8. Waits for backend health check
9. Seeds ACL system
10. Creates admin user (sandbox@xyne.ai)
11. Generates `.sandbox.json` config file

## Image Caching
Images are tagged with a 12-char hash of all 4 `package-lock.json` files + both Dockerfiles. First sandbox build takes ~5min for images. Subsequent sandboxes reuse cached images (~2min total). If you run `npm install` and lockfiles change, the next `create` auto-detects and rebuilds. Use `build-images` to force-rebuild manually.

## Architecture
```
                         ┌─────────────────────┐
    http://x.localhost   │     Traefik :80      │
    ─────────────────►   │   reverse proxy      │
                         └──────┬──────┬────────┘
                                │      │
                    ┌───────────┘      └───────────┐
                    ▼                               ▼
         ┌─────────────────┐             ┌─────────────────┐
         │   Sandbox "x"   │             │   Sandbox "y"   │
         │  ┌─────────┐   │             │  ┌─────────┐   │
         │  │Dashboard │   │             │  │Dashboard │   │
         │  │  :5173   │   │             │  │  :5173   │   │
         │  └─────────┘   │             │  └─────────┘   │
         │  ┌─────────┐   │             │  ┌─────────┐   │
         │  │ Backend  │   │             │  │ Backend  │   │
         │  │  :3001   │   │             │  │  :3001   │   │
         │  └─────────┘   │             │  └─────────┘   │
         │  ┌─────────┐   │             │  ┌─────────┐   │
         │  │  Zero    │   │             │  │  Zero    │   │
         │  │  :4848   │   │             │  │  :4848   │   │
         │  └─────────┘   │             │  └─────────┘   │
         └────────┬────────┘             └────────┬────────┘
                  │                               │
         ┌────────┴───────────────────────────────┘
         │           Shared Infrastructure
         │  ┌──────────┐ ┌───────┐ ┌─────────┐
         │  │ Postgres  │ │ Redis │ │ LiveKit │ ...
         │  │  :5433    │ │ :6379 │ │  :7880  │
         │  └──────────┘ └───────┘ └─────────┘
         └─────────────────────────────────────
```

## Routing
Traefik routes based on `Host(<name>.localhost)` subdomain. Port numbers are not needed because all traffic goes through port 80.
- `/api/*` → backend (priority 20)
- `/zero/*` → zero-cache (priority 20)
- Everything else → dashboard (priority 10)

## Auth (Sandbox Only)
Google OAuth is bypassed in sandbox environments. The backend runs with `ENABLE_DEV_AUTH=true` which enables test auth endpoints. On first visit, you're auto-logged in as `sandbox@xyne.ai` (pre-created admin). This is detected by the `*.localhost` hostname in the dashboard's `config.ts`.

## Hot Reload
- **Backend**: Uses `tsx watch` with polling (`CHOKIDAR_USEPOLLING=true`). Edit files in `.sandboxes/<name>/backend/` → auto-restarts.
- **Dashboard**: Uses Vite HMR. Edit files in `.sandboxes/<name>/dashboard/` → instant browser update.
- **Shared/Framework**: Changes to shared/framework need a rebuild: `cd .sandboxes/<name>/shared && npm run build`.

## Installing Packages
```bash
# Install in backend container
npm run sandbox -- exec my-sandbox npm install dayjs

# Install in dashboard container  
npm run sandbox -- exec my-sandbox dashboard npm install some-package

# Note: package.json is updated in the worktree via bind mount
# Container's node_modules volume is updated immediately
# Other sandboxes are NOT affected
```

## File Structure
```
.sandboxes/
└── my-sandbox/              # Git worktree (branch: sandbox/my-sandbox)
    ├── docker-compose.yml   # Generated per-sandbox compose
    ├── .sandbox.json        # Sandbox metadata (URLs, DB, containers)
    ├── .env.sandbox         # Sandbox env vars
    ├── backend/             # Backend source (edit here for hot reload)
    ├── dashboard/           # Dashboard source (edit here for hot reload)
    ├── shared/              # Shared module
    └── framework/           # Framework module
```

## Shared Infrastructure Services
| Service | Container | Port (host) | Purpose |
| :--- | :--- | :--- | :--- |
| Traefik | xyne-sandbox-traefik | 80 | Reverse proxy |
| PostgreSQL | xyne-sandbox-postgres | 5433 | Database (logical DB per sandbox) |
| Redis | xyne-sandbox-redis | 6379 | Cache/pubsub |
| LiveKit | xyne-sandbox-livekit | 7880 | WebRTC/voice |
| Fake GCS | xyne-sandbox-fake-gcs | 4443 | Object storage emulator |
| Superposition | xyne-sandbox-superposition | 9999 | Feature flags |
| OTEL Collector | xyne-sandbox-otel-collector | 4318 | Telemetry |
| VictoriaMetrics | xyne-sandbox-victoriametrics | 8428 | Metrics storage |
| Grafana | xyne-sandbox-grafana | 3333 | Monitoring dashboard |
| Y-Sweet | (from include) | — | CRDT sync |

## Naming Rules
Lowercase alphanumeric + hyphens only. Max 30 characters.
- Examples: `agent-1`, `feature-auth`, `test3`
- DB name derived: `agent-1` → `sandbox_agent_1_db`
- ZERO_APP_ID derived: `agent-1` → `sandbox_agent_1` (underscores, no hyphens — critical for replication slots)

## Troubleshooting
- **Port 80 in use**: Stop any local web server or `npm run services:stop` if dev compose is running.
- **Sandbox won't start**: Check `npm run sandbox -- logs <name> backend` for errors.
- **DB connection issues**: Ensure shared infra is running: `npm run sandbox -- infra up`.
- **Stale images after npm install**: Run `npm run sandbox -- build-images` or just create a new sandbox (auto-detects).
- **Worktree missing uncommitted changes**: Worktrees are created from HEAD. Commit your changes first.
- **"Sandbox already exists"**: Destroy first: `npm run sandbox -- destroy <name>`.
- **Zero replication slot conflict**: Each sandbox gets a unique ZERO_APP_ID. If issues persist, destroy and recreate.

## For AI Agents
```bash
# Create isolated environment
npm run sandbox -- create agent-1

# Work on code in .sandboxes/agent-1/
# Changes hot-reload automatically

# Install dependencies if needed
npm run sandbox -- exec agent-1 npm install <package>

# Check status
npm run sandbox -- status agent-1

# When done
npm run sandbox -- destroy agent-1
```
