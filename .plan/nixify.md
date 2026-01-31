# Nixification Plan for xyne-spaces

This document outlines the plan to nixify the xyne-spaces repository, modeled after the Nammayatri repository's approach.

## Current State Analysis

### Repository Structure
```
xyne-spaces/
├── backend/          # Node.js/TypeScript backend (Express, Prisma, Bull)
├── dashboard/        # React/Vite frontend (TypeScript, TailwindCSS)
├── framework/        # Shared TypeScript library
├── docker/           # Docker configuration files
├── scripts/          # Shell scripts (start-services.sh, cleanup-storage.sh)
├── Makefile          # Docker image builds
├── docker-compose.dev.yml  # Infrastructure services
└── package.json      # Root package with scripts
```

### Current Development Workflow
1. **Services**: `npm run services` → runs docker-compose (postgres, redis, livekit, zero-cache)
2. **Backend**: `cd backend && npm i && npm run dev` → runs Express server on port 3001
3. **Frontend**: `cd dashboard && npm i && npm run dev` → runs Vite dev server

### Infrastructure Services (docker-compose.dev.yml)
- **PostgreSQL 16** (port 5433) - Main database
  - Requires WAL level = logical for Zero (CDC)
  - Requires max_replication_slots = 10
  - Init script: `docker/init-db.sh`
- **Redis 7** (port 6379) - Caching and job queues
- **LiveKit** (ports 7880-7882) - Real-time video/audio service
- **Zero Cache** (ports 4848-4849) - Real-time sync service (connects to postgres)

### Key Dependencies
- **Node.js**: v22 (backend and dashboard both require >=18)
- **npm**: >=8.0.0
- **Python**: Python 3 (for backend scripts: art_processor.py, generate_prompt.py)
- **Backend**: TypeScript, Express, Prisma, Bull, Socket.io, Livekit SDK
- **Dashboard**: React 19, Vite, TailwindCSS, Zero client
- **Framework**: Shared TypeScript library (built first, referenced by backend)

### Backend Scripts (need Nix wrappers)
- **seed-acl.ts**: Creates ACL resources and default user groups (ADMIN, DEVELOPER, etc.)
- **assign-user-group.ts**: Assigns a user to DEVELOPER group (run during first setup)
- **seed.ts**: Database seeding
- **verify-users.ts**: User verification
- **test-notifications.ts**: Notification testing
- **encrypt-credentials.cjs**: Credential encryption
- **setup-external-source.cjs**: External source setup
- **art_processor.py**: Art processing (Python)
- **generate_prompt.py**: Prompt generation (Python)
- **process_art_resp.py**: Art response processing (Python)

### Shell Scripts (to be nixified)
- **scripts/start-services.sh**:
  - Detects docker/podman
  - Stops local PostgreSQL if running
  - Starts docker-compose services (postgres, redis, livekit)
  - Waits for services to be healthy
  - Runs Prisma migrations
  - Seeds ACL system
  - Creates developer user
  - Starts zero-cache
- **scripts/cleanup-storage.sh**:
  - Detects docker/podman
  - Stops all containers
  - Removes all containers, images
  - Prunes system
  - Resets podman machine (if applicable)
- **docker/init-db.sh**:
  - Sets PostgreSQL WAL level to logical
  - Sets max_replication_slots = 10
  - Sets max_wal_senders = 10

## Nammayatri's Nix Architecture (Reference)

### Structure
```
nammayatri/
├── flake.nix                    # Main flake entry point
├── Backend/default.nix          # Backend module
├── Frontend/default.nix         # Frontend module
└── Backend/nix/
    ├── services/                # Custom service modules
    ├── run-mobility-stack.nix   # process-compose configuration
    ├── arion-configuration.nix  # Docker services (monitoring)
    ├── scripts.nix              # Dev scripts
    ├── docker.nix               # Docker image builds
    └── pre-commit.nix           # Pre-commit hooks

common/ (separate repo)
├── flake.nix                    # Common infrastructure
└── flake-module.nix             # Shared flake-parts modules
```

### Key Nix Technologies Used
- **flake-parts**: Modular flake organization
- **services-flake**: Managing services (postgres, redis, etc.)
- **process-compose-flake**: Running multiple processes together
- **arion**: Docker-based services (for LiveKit, Zero Cache)

## Nixification Plan

The plan is organized incrementally - each phase replaces one existing workflow while keeping others working.

**Status Legend:**
- ✅ **DONE** - Completed and tested
- 🔲 **PLANNED** - Not yet started

---

### Phase 1: Foundation Setup ✅ **DONE**

**Goal**: Basic Nix infrastructure without changing existing workflows

#### 1.1 Create minimal flake.nix
- **Location**: `/flake.nix`
- **Purpose**: Minimal entry point
- **Key sections**:
  ```nix
  {
    inputs = {
      nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
      flake-parts.url = "github:hercules-ci/flake-parts";
      systems.url = "github:nix-systems/default";
    };
    outputs = inputs:
      inputs.flake-parts.lib.mkFlake { inherit inputs; } {
        systems = import inputs.systems;
        perSystem = { pkgs, ... }: {
          devShells.default = pkgs.mkShell {
            name = "xyne-spaces";
            packages = with pkgs; [
              nodejs_22
              jq
            ];
          };
        };
      };
  }
  ```

#### 1.2 Create .envrc
- **Content**: `use flake`
- **Test**: `direnv allow` and verify shell loads

#### 1.3 Test ✅
- ✅ `nix develop` works
- ✅ Existing workflows (`npm run services`, `cd backend && npm run dev`) still work
- ✅ Node.js 22.21.1 available
- ✅ All files staged in git

**Files created:**
- `flake.nix` - Minimal flake with basic devShell
- `flake.lock` - Generated lock file
- `.envrc` - Direnv integration
- `.gitignore` - Updated with Nix artifacts

---

### Phase 2: Nixify Services (Replace `npm run services`) ✅ **DONE**

**Goal**: Replace `npm run services` with Nix-managed services

**Status**: Completed - All services configured with reproducible Docker images

#### 2.1 Add services-flake input
- Update `flake.nix` to add `services-flake` input
  ```nix
  inputs = {
    # ... existing inputs
    services-flake.url = "github:juspay/services-flake";
  };
  ```

#### 2.2 Configure PostgreSQL service
- Create `nix/services.nix`:
  ```nix
  { inputs, ... }: {
    perSystem = { config, pkgs, ... }: {
      services.postgres."xyne-db" = {
        enable = true;
        port = 5433;
        initialDatabases = [
          {
            name = "xyne_dev_db";
          }
        ];
        initialScript.before = ''
          CREATE USER xyne WITH PASSWORD 'xyne123';
        '';
        initialScript.after = ''
          -- Configure for Zero (CDC)
          ALTER SYSTEM SET wal_level = logical;
          ALTER SYSTEM SET max_replication_slots = 10;
          ALTER SYSTEM SET max_wal_senders = 10;
          SELECT pg_reload_conf();
        '';
      };
    };
  }
  ```

#### 2.3 Configure Redis service
- Add to `nix/services.nix`:
  ```nix
  services.redis."xyne-redis" = {
    enable = true;
    port = 6379;
  };
  ```

#### 2.4 Add arion for Docker services
- Add `arion` input to flake.nix
- Create `nix/arion-services.nix` for LiveKit and Zero Cache:
  ```nix
  { ... }: {
    perSystem = { pkgs, ... }: {
      arionProjectConfiguration = { ... }: {
        project.name = "xyne-services";
        services = {
          livekit.service = {
            image = "livekit/livekit-server:latest";
            command = "--config /etc/livekit.yaml --dev";
            ports = [ "7880:7880" "7881:7881" "7882:7882/udp" ];
            volumes = [ "${../docker/livekit.yaml}:/etc/livekit.yaml" ];
          };
          zero-cache.service = {
            image = "rocicorp/zero:latest";
            environment = {
              ZERO_UPSTREAM_DB = "postgresql://xyne:xyne123@host.containers.internal:5433/xyne_dev_db";
              # ... other env vars
            };
            ports = [ "4848:4848" "4849:4849" ];
            depends_on = [ "postgres" ];
          };
        };
      };
    };
  }
  ```

#### 2.5 Create process-compose for services
- Add `process-compose-flake` input
- Create `nix/run-services.nix`:
  ```nix
  { ... }: {
    perSystem = { config, pkgs, ... }: {
      process-compose."services" = {
        imports = [
          inputs.services-flake.processComposeModules.default
        ];
        settings.processes = {
          # postgres and redis handled by services-flake
          # livekit and zero-cache via arion or direct docker-compose
        };
      };
    };
  }
  ```

#### 2.6 Test ✅
- ✅ All services configured in `flake.nix`
- ✅ PostgreSQL (port 5433) with WAL configuration for Zero CDC
- ✅ Redis (port 6379)
- ✅ LiveKit Docker image pinned via `dockerTools.pullImage`
- ✅ Zero Cache Docker image pinned via `dockerTools.pullImage`
- ✅ `nix build .#services` builds successfully
- ✅ `nix flake show` displays all expected outputs

**Implemented:**
- All infrastructure services inline in `flake.nix` (no separate nix/ directory)
- Reproducible Docker images using pinned digests and hashes:
  - LiveKit: `sha256:9e34...` → `sha256-wdwHQ3M2...`
  - Zero Cache: `sha256:c7e0...` → `sha256-i4WEwuXClm...`
- Docker images loaded from Nix store into Podman at runtime
- Process dependencies configured (zero-cache depends on postgres)
- PostgreSQL configured with logical WAL level for Zero's Change Data Capture

**Files modified:**
- `flake.nix` - Added services-flake, process-compose, pinned Docker images
- `flake.lock` - Updated with new inputs

**Usage:**
```bash
# Start all services (in terminal with TUI)
nix run .#services

# Or use the old way (still works)
npm run services
```

---

### Phase 3: Nixify Backend Dev Workflow 🔲 **PLANNED**

**Goal**: Replace `cd backend && npm run dev` with Nix-managed backend

#### 3.1 Create backend dev process
- Create `nix/run-backend.nix`:
  ```nix
  { ... }: {
    perSystem = { pkgs, ... }: {
      apps.backend-dev = {
        type = "app";
        program = pkgs.writeShellScript "backend-dev" ''
          cd backend
          npm install
          npm run dev
        '';
      };
    };
  }
  ```

#### 3.2 Add database scripts
- Create flake apps for:
  - `db-migrate`: Run Prisma migrations
  - `db-seed-acl`: Seed ACL system
  - `create-dev-user`: Create developer user
  - `db-studio`: Open Prisma Studio

#### 3.3 Test
- `nix run .#backend-dev` starts backend
- Database scripts work via `nix run .#db-migrate` etc.

---

### Phase 4: Nixify Dashboard Dev Workflow 🔲 **PLANNED**

**Goal**: Replace `cd dashboard && npm run dev` with Nix-managed dashboard

#### 4.1 Create dashboard dev process
- Create `nix/run-dashboard.nix`:
  ```nix
  { ... }: {
    perSystem = { pkgs, ... }: {
      apps.dashboard-dev = {
        type = "app";
        program = pkgs.writeShellScript "dashboard-dev" ''
          cd dashboard
          npm install
          npm run dev
        '';
      };
    };
  }
  ```

#### 4.2 Test
- `nix run .#dashboard-dev` starts dashboard
- Full stack works: services + backend + dashboard

---

### Phase 5: Full Dev Stack Integration 🔲 **PLANNED**

**Goal**: Run everything together with one command

#### 5.1 Create integrated process-compose
- Create `nix/run-dev-stack.nix`:
  ```nix
  { ... }: {
    perSystem = { config, pkgs, ... }: {
      process-compose."dev-stack" = {
        settings.processes = {
          # Import services
          postgres = { /* from services-flake */ };
          redis = { /* from services-flake */ };

          # Backend
          backend = {
            command = "cd backend && npm run dev";
            depends_on.postgres.condition = "process_healthy";
            depends_on.redis.condition = "process_healthy";
          };

          # Dashboard
          dashboard = {
            command = "cd dashboard && npm run dev";
            depends_on.backend.condition = "process_started";
          };
        };
      };
    };
  }
  ```

#### 5.2 Test
- `nix run .#dev-stack` starts everything
- Or via individual commands for development

---

### Phase 6: Docker Image Builds 🔲 **PLANNED**

**Goal**: Replace Makefile Docker builds with Nix

#### 6.1 Create Docker images
- Create `nix/docker.nix`:
  ```nix
  { ... }: {
    perSystem = { pkgs, ... }: {
      packages = {
        dockerImage-backend = pkgs.dockerTools.buildLayeredImage {
          name = "xyne-spaces-backend";
          tag = "latest";
          # ... image config
        };
        dockerImage-dashboard = pkgs.dockerTools.buildLayeredImage {
          name = "xyne-spaces-dashboard";
          tag = "latest";
          # ... image config
        };
      };
    };
  }
  ```

#### 6.2 Test
- `nix build .#dockerImage-backend`
- `nix build .#dockerImage-dashboard`
- **Remove Makefile** once verified

---

### Phase 7: Justfile Integration 🔲 **PLANNED**

#### 7.1 Create justfile
- **Purpose**: Convenient command runner (like Makefile, but simpler)
- **Location**: `/justfile`
- **Example recipes**:
  ```justfile
  # Default recipe - show available commands
  default:
    @just --list

  # Development workflows
  dev-all: services backend dashboard

  services:
    nix run .#run-services

  backend:
    nix run .#run-backend-dev

  dashboard:
    nix run .#run-dashboard-dev

  # Database commands
  db-migrate:
    nix run .#db-migrate

  db-seed:
    nix run .#db-seed

  db-seed-acl:
    nix run .#db-seed-acl

  db-reset:
    nix run .#db-reset

  db-studio:
    nix run .#db-studio

  # Create developer user
  create-dev-user EMAIL:
    nix run .#create-dev-user -- {{EMAIL}}

  # Cleanup
  cleanup:
    nix run .#cleanup-storage

  # Build Docker images
  build-backend:
    nix build .#dockerImage-backend

  build-dashboard:
    nix build .#dockerImage-dashboard

  build-all: build-backend build-dashboard

  # Lint and format (using npm/package.json scripts)
  lint:
    cd backend && npm run lint
    cd dashboard && npm run lint

  # Type check
  check:
    nix flake check
  ```

---

### Phase 8: Documentation & Cleanup 🔲 **PLANNED**

#### 8.1 Update README.md
- Add Nix installation instructions
- Document new development workflow:
  ```bash
  # Enter development shell
  nix develop

  # Or use direnv (automatic)
  direnv allow

  # Start all services
  just services

  # Start backend
  just backend

  # Start dashboard
  just dashboard

  # Run everything together
  just dev-all
  # or: nix run .#run-dev-stack

  # Database operations
  just db-migrate
  just db-seed-acl
  just create-dev-user your.email@example.com

  # Build Docker images
  just build-all
  ```

#### 8.2 Create DEVELOPMENT.md
- Detailed Nix development guide
- Available commands (justfile recipes)
- Service management
- Troubleshooting

#### 8.3 Cleanup old files
- **Remove**: `scripts/` directory
- **Remove**: `Makefile`
- **Remove**: `docker-compose.dev.yml`
- **Remove**: `package.json` root scripts (optional, if not needed)

## Directory Structure (Target)

```
xyne-spaces/
├── flake.nix                    # Main flake entry point
├── flake.lock                   # Flake lock file
├── justfile                     # Command runner (replaces Makefile, scripts/)
├── .envrc                       # Direnv integration (single file)
├── backend/
│   ├── default.nix              # Backend flake module
│   ├── scripts/                 # TypeScript/Python scripts (kept as is)
│   │   ├── seed-acl.ts
│   │   ├── assign-user-group.ts
│   │   ├── seed.ts
│   │   ├── verify-users.ts
│   │   ├── test-notifications.ts
│   │   ├── encrypt-credentials.cjs
│   │   ├── setup-external-source.cjs
│   │   ├── art_processor.py
│   │   ├── generate_prompt.py
│   │   └── process_art_resp.py
│   └── nix/
│       ├── services.nix         # services-flake configuration
│       ├── run-dev-stack.nix    # process-compose configuration
│       ├── scripts.nix          # Flake apps (wraps scripts/)
│       ├── docker.nix           # Docker image builds
│       ├── nodejs.nix           # Node.js package builds
│       └── arion-configuration.nix  # Docker services (livekit, zero-cache)
├── dashboard/
│   ├── default.nix              # Frontend flake module
│   └── nix/
│       ├── scripts.nix          # Frontend scripts
│       └── docker.nix           # Dashboard Docker image
├── framework/
│   └── (keep as is - npm package, optionally add nix/default.nix later)
├── docker/                      # Docker configs for arion (livekit.yaml, etc.)
│   └── livekit.yaml             # LiveKit configuration
├── scripts/                     # REMOVED - all functionality in Nix
├── Makefile                     # REMOVED - replaced by justfile + Nix
├── docker-compose.dev.yml       # REMOVED - replaced by services-flake
└── .plan/
    └── nixify.md                # This file
```

**Key changes**:
- `scripts/` directory **REMOVED** - all shell scripts replaced by Nix
- `backend/scripts/` **KEPT** - TypeScript/Python scripts wrapped by Nix
- `Makefile` **REMOVED** - replaced by `justfile` + Nix flake apps
- `docker-compose.dev.yml` **REMOVED** - replaced by services-flake + arion
- `justfile` **ADDED** - convenient command runner for Nix operations

## Migration Strategy

### Approach: Incremental, Non-Breaking Migration

Each phase replaces one workflow while keeping others intact:

1. **Phase 1**: Add Nix foundation - existing workflows untouched
2. **Phase 2**: Replace `npm run services` - can still use old way if needed
3. **Phase 3**: Replace backend dev - services already nixified
4. **Phase 4**: Replace dashboard dev - backend already nixified
5. **Phase 5**: Integrated stack - individual pieces already work
6. **Phase 6**: Replace Docker builds - dev workflows already nixified
7. **Phase 7**: Add justfile convenience layer
8. **Phase 8**: Documentation and remove old files

### Testing at Each Phase

- **Phase 1**: `nix develop` works, doesn't break npm workflows
- **Phase 2**: Services start via Nix, backend/dashboard can connect
- **Phase 3**: Backend runs via Nix, connects to Nix services
- **Phase 4**: Dashboard runs via Nix, connects to Nix backend
- **Phase 5**: Everything runs together with dependencies
- **Phase 6**: Docker images build and work same as before
- **Phase 7**: Justfile commands work
- **Phase 8**: Old files removed, docs updated

### Rollback Strategy

Each phase can be rolled back independently:
- Git commits per phase
- Old files kept until Phase 8
- Can fall back to `npm run services` etc. at any time

## Key Differences from Nammayatri

1. **No separate common repo**: All Nix code lives in xyne-spaces repo
   - Nammayatri has a separate `common` flake
   - xyne-spaces will have all flake-parts modules inline
   - Simpler, no external dependencies

2. **Simpler architecture**: Nammayatri may be overengineered for our needs
   - xyne-spaces can be simpler
   - Fewer abstraction layers
   - More straightforward Nix modules

3. **Language**: Nammayatri uses Haskell, xyne-spaces uses Node.js/TypeScript
   - Skip haskell-flake
   - Use buildNpmPackage or simple npm scripts instead

4. **Services**: xyne-spaces has different services
   - LiveKit (video/audio) - not in Nammayatri
   - Zero Cache (real-time sync) - not in Nammayatri
   - No Kafka, ClickHouse (simpler stack)

5. **Monorepo**: xyne-spaces has framework dependency
   - Need to build framework first
   - Backend depends on framework build

6. **Development tools**: xyne-spaces uses justfile
   - Nammayatri uses mission-control
   - justfile is simpler and more widely used

## Open Questions / Decisions Needed

1. **Zero Cache**: Docker or native? (Recommend Docker via arion)
2. **LiveKit**: Docker or native? (Recommend Docker via arion)
3. **Framework**: Build as Nix package or just npm? (Recommend npm for now, Nix later)
4. **CI/CD**: Migrate Jenkinsfile immediately or later? (Recommend later)
5. **Backwards compat**: Keep Makefile during migration? (Recommend remove once Nix works)
6. **Mission-control vs justfile**: Use mission-control or justfile? (Recommend justfile - simpler)

## Success Criteria

- [x] `nix develop` drops into working dev shell ✅ **Phase 1**
- [x] `nix run .#services` starts all infrastructure services ✅ **Phase 2**
- [ ] `just backend` starts backend (Phase 3)
- [ ] `just dashboard` starts dashboard (Phase 4)
- [ ] `just dev-all` starts everything together (Phase 5)
- [ ] `just build-backend` builds backend Docker image (Phase 6)
- [ ] `just build-dashboard` builds dashboard Docker image (Phase 6)
- [ ] All existing functionality preserved (Phase 8)
- [ ] Documentation updated (Phase 8)
- [ ] Team trained on new workflow (Phase 8)

## Timeline Estimate

- ✅ **Phase 1** (Foundation): 1 day - **COMPLETED**
- ✅ **Phase 2** (Services - replace `npm run services`): 1 day - **COMPLETED**
- 🔲 **Phase 3** (Backend dev workflow): 1-2 days
- 🔲 **Phase 4** (Dashboard dev workflow): 1 day
- 🔲 **Phase 5** (Integrated dev stack): 1-2 days
- 🔲 **Phase 6** (Docker builds): 2 days
- 🔲 **Phase 7** (Justfile): 1 day
- 🔲 **Phase 8** (Docs & cleanup): 1-2 days

**Total**: ~1.5-2 weeks (working solo, full-time)

**Progress**: 2/8 phases complete (25%)

**Note**: Each phase is independently testable and doesn't break existing workflows

## Next Steps

1. Review this plan with team
2. Answer open questions
3. Start with Phase 1 (Foundation)
4. Iterate on plan as we learn
