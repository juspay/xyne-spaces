# Main project configuration for xyne-spaces
#
# This mirrors docker-compose.dev.yml service-for-service; when a service is
# added or changed there, change it here too:
#   postgres (xyne_dev_db + xyne_common + claw_auth_db)  ← docker/init-db.sh
#   redis · livekit · zero-cache · fake-gcs · minio · ysweet
#   otel-collector · victoriametrics · grafana
#   transcription-agent (python)
#   superposition · livekit-egress (container images only — run via docker/podman
#   when available, skipped with a warning otherwise)
{ pkgs, lib, flakeInputs, ... }:
let
  # Every port the stack binds. Keep in sync with docker-compose.dev.yml.
  allPorts = [
    5433 # postgres
    6379 # redis
    7880 # livekit
    4848 # zero-cache
    4849 # zero-cache (change streamer)
    8080 # ysweet
    4443 # fake-gcs
    9000 # minio api
    9001 # minio console
    8001 # transcription-agent health
    4317 # otel grpc
    4318 # otel http
    8888 # otel self-metrics
    8428 # victoriametrics
    3333 # grafana
    9999 # superposition
  ];
  portList = lib.concatMapStringsSep " " toString allPorts;

  # Run a docker-image-only service via docker/podman, or skip gracefully.
  # Used for services with no native package (superposition, livekit-egress).
  containerFallback = name: runArgs: pkgs.writeShellScript "container-${name}" ''
    RUNTIME=$(command -v docker || command -v podman || true)
    if [ -z "$RUNTIME" ]; then
      echo "⚠ ${name}: docker/podman not found — skipping (container-image-only service)"
      exec tail -f /dev/null
    fi
    "$RUNTIME" rm -f xyne-nix-${name} 2>/dev/null || true
    exec "$RUNTIME" run --rm --name xyne-nix-${name} \
      --add-host host.docker.internal:host-gateway \
      ${runArgs}
  '';
in
{
  imports = [
    ./nix/modules/devshell.nix
  ];

  # Development shell configuration
  devShell = {
    name = "xyne-spaces-dev";

    packages = with pkgs; [
      nodejs_22
      pnpm # repo pins pnpm 10.x via packageManager/corepack; nixpkgs' pnpm 10 works
      just
    ];

    banner = ''
      # Xyne Spaces Dev Environment

      Node.js: ${pkgs.nodejs_22.version} · pnpm: ${pkgs.pnpm.version}

      ## Getting Started

      ```bash
      pnpm run env:setup && pnpm run setup && pnpm run secrets  # one-time
      nix run .#xyne-space-services   # infra (or `just services` for docker)
      pnpm run dev:all                # backend + dashboard + claw + auth
      ```

      ## Cleanup

      ```bash
      nix run .#cleanup   # ports + database volumes (like docker compose down -v)
      ```

      Edit `project.nix` to modify the Nix setup. Run `just` for all commands.
    '';
  };

  # Process-compose configuration for all services
  process-compose."xyne-space-services" = {
    imports = [
      flakeInputs.services-flake.processComposeModules.default
      ./nix/containers
      ./nix/services/livekit.nix
      ./nix/services/zero-cache.nix
    ];

    # Create data directories and cleanup ports before starting processes
    cli.preHook = ''
      echo "🧹 Cleaning up development services..."
      pkill -f process-compose 2>/dev/null || true

      for port in ${portList}; do
        lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
      done

      sleep 1
      echo "✓ All development ports are free"

      mkdir -p data/zero-cache data/ysweet data/fake-gcs data/minio \
               data/victoriametrics data/grafana .logs .nix-cache
    '';

    # Configure log files for all processes
    defaults.processSettings = { name, ... }: {
      log_location = ".logs/${name}.log";
    };

    # Database setup process (runs once after PostgreSQL is ready).
    #
    # Mirrors the pnpm setup (scripts/start-services.sh "Database setup"
    # section) step for step — same schema pushes, same seed scripts, same
    # workspace verification. If start-services.sh changes, change this too.
    settings.processes.db-setup = {
      command = toString (pkgs.writeShellScript "db-setup" ''
        set -e
        set -o pipefail

        echo "=== Starting database setup process ==="
        ROOT="$PWD"
        rm -f "$ROOT/data/.db-setup-ready"
        PSQL="${pkgs.postgresql}/bin/psql -h 127.0.0.1 -p 5433 -U xyne"
        PNPM="${pkgs.pnpm}/bin/pnpm"

        if ! $PSQL -d xyne_dev_db -c "SELECT 1;" > /dev/null 2>&1; then
          echo "ERROR: PostgreSQL is not ready"
          exit 1
        fi
        echo "✓ PostgreSQL is healthy"

        BACKEND_DIR="$PWD/apps/backend"

        if [ ! -d "$BACKEND_DIR/node_modules" ]; then
          echo "Backend dependencies not installed. Skipping database setup."
          echo "Run: pnpm install (repo root)"
          exit 0
        fi

        cd "$BACKEND_DIR"

        USER_COUNT=$($PSQL -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || echo "ERROR")
        USER_COUNT=$(echo "$USER_COUNT" | xargs)

        if [[ "$USER_COUNT" == *"ERROR"* ]] || [[ "$USER_COUNT" == *"does not exist"* ]] || [ -z "$USER_COUNT" ]; then
          echo "Setting up database from scratch..."

          # A force-reset invalidates zero-cache's replica; wipe it so zero
          # resyncs from scratch (start-services.sh removes the volume).
          rm -rf "$ROOT/data/zero-cache"
          mkdir -p "$ROOT/data/zero-cache"

          echo "  Flushing Redis (stale queue jobs reference the dropped database)..."
          ${pkgs.redis}/bin/redis-cli -h 127.0.0.1 -p 6379 FLUSHALL >/dev/null 2>&1 || true

          echo "  Creating database schema..."
          $PNPM exec dotenv -e .env.local -- pnpm exec prisma db push --force-reset --accept-data-loss --skip-generate

          echo "  Creating common database schema..."
          $PNPM exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma --force-reset --accept-data-loss --skip-generate

          echo "  Generating Prisma clients..."
          $PNPM exec prisma generate
          $PNPM exec prisma generate --schema prisma-common/schema.prisma

          echo "  Seeding ACL system..."
          $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts

          echo "  Creating developer user..."
          $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-user-group.ts

          echo "  Seeding app permission registry..."
          $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-app-permissions.ts
        else
          echo "Syncing database schema..."
          $PNPM exec dotenv -e .env.local -- pnpm exec prisma db push

          echo "Syncing common database schema..."
          $PNPM exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma --accept-data-loss --skip-generate
          $PNPM exec prisma generate --schema prisma-common/schema.prisma

          # Only a bare integer means the query answered; anything else means
          # "cannot conclude" — seed to be safe (seeding is idempotent).
          WORKSPACE_EXISTS=$($PSQL -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
          if printf '%s' "$WORKSPACE_EXISTS" | grep -qE '^[0-9]+$' && [ "$WORKSPACE_EXISTS" != "0" ]; then
            echo "✓ Default workspace exists"
          else
            echo "  Default workspace missing/unreadable. Seeding to be safe..."
            $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
            $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-user-group.ts 2>/dev/null \
              || echo "  Developer user already present"
          fi
        fi

        # Verify the seed actually produced a workspace before anything
        # downstream depends on it — same gate as start-services.sh.
        WORKSPACE_CHECK=$($PSQL -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
        if ! printf '%s' "$WORKSPACE_CHECK" | grep -qE '^[1-9][0-9]*$'; then
          echo "ERROR: database setup finished but there is no \"Default Workspace\" (psql said: $WORKSPACE_CHECK)"
          exit 1
        fi

        # Sample workspace content — non-fatal, skips itself if already run.
        if [ "''${SKIP_DEMO_SEED:-0}" != "1" ]; then
          echo "  Seeding sample workspace data..."
          $PNPM exec dotenv -e .env.local -- pnpm exec tsx scripts/demo-seed.ts \
            || echo "  Sample data seeding failed — continuing without it."
        fi

        echo "✓ Database ready"
        touch "$ROOT/data/.db-setup-ready"
        tail -f /dev/null
      '');

      depends_on = {
        xyne-db = { condition = "process_healthy"; };
        xyne-redis = { condition = "process_healthy"; };
      };

      readiness_probe = {
        exec.command = "test -f data/.db-setup-ready";
        initial_delay_seconds = 2;
        period_seconds = 3;
        timeout_seconds = 2;
        success_threshold = 1;
        failure_threshold = 200; # schema push + seeds can take minutes on first run
      };

      namespace = "setup.db-setup";
      availability.restart = "on_failure";
    };

    # Disable TUI for headless operation
    settings.environment.PC_DISABLE_TUI = "true";

    # PostgreSQL service — one cluster, three logical databases, exactly like
    # docker/init-db.sh (xyne_dev_db, xyne_common, claw_auth_db + claw role).
    services.postgres."xyne-db" = {
      enable = true;
      listen_addresses = "127.0.0.1";
      port = 5433;

      superuser = "xyne";

      initialDatabases = [
        { name = "xyne_dev_db"; }
        { name = "xyne_common"; }
        { name = "claw_auth_db"; }
      ];

      initialScript.after = ''
        -- Configure for Zero (Change Data Capture)
        ALTER SYSTEM SET wal_level = logical;
        ALTER SYSTEM SET max_replication_slots = 10;
        ALTER SYSTEM SET max_wal_senders = 10;
        SELECT pg_reload_conf();

        -- claw-auth connects as its own role (parity with docker/init-db.sh)
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'claw') THEN
            CREATE ROLE claw LOGIN PASSWORD 'claw123';
          END IF;
        END
        $$;

        GRANT ALL PRIVILEGES ON DATABASE xyne_dev_db TO xyne;
        GRANT ALL PRIVILEGES ON DATABASE xyne_common TO xyne;
        GRANT ALL PRIVILEGES ON DATABASE claw_auth_db TO claw;
        ALTER DATABASE claw_auth_db OWNER TO claw;
      '';
    };

    # Redis service
    services.redis."xyne-redis" = {
      enable = true;
      port = 6379;
    };

    # LiveKit service
    services.livekit."xyne-livekit" = {
      enable = true;
      port = 7880;
      rtcPortRangeStart = 50000;
      rtcPortRangeEnd = 60000;
      apiKey = "devkey";
      apiSecret = "devsecret";
      configFile = ./docker/livekit.yaml;
      devMode = true;
      logLevel = "debug";
    };

    # Zero Cache service (native, no container required)
    services.zero-cache."xyne-zero" = {
      enable = true;
      port = 4848;
      upstreamDb = "postgresql://xyne:xyne123@127.0.0.1:5433/xyne_dev_db";
      cvrDb = "postgresql://xyne:xyne123@127.0.0.1:5433/xyne_dev_db";
      changeDb = "postgresql://xyne:xyne123@127.0.0.1:5433/xyne_dev_db";
      replicaFile = "./data/zero-cache/replica.db";
      logLevel = "info";
      adminPassword = "dev-admin-password";
      authSecret = builtins.getEnv "ZERO_AUTH_SECRET";
      mutateUrl = "http://127.0.0.1:3001/api/zero/push";
      queryUrl = "http://127.0.0.1:3001/api/zero/query";
      numSyncWorkers = 5;
      upstreamMaxConns = 10;
      cvrMaxConns = 20;
      extraEnv = {
        ZERO_QUERY_FORWARD_COOKIES = "true";
        ZERO_MUTATE_FORWARD_COOKIES = "true";
      };
    };

    # zero-cache starts only after the database is set up — a schema
    # force-reset with zero attached would leave a stale replica (parity with
    # start-services.sh, which starts zero-cache after the DB section).
    settings.processes."xyne-zero".depends_on."xyne-db".condition = "process_healthy";
    settings.processes."xyne-zero".depends_on."db-setup".condition = "process_healthy";

    # Fake GCS Server (native Nix package)
    settings.processes.fake-gcs = {
      command = toString (pkgs.writeShellScript "fake-gcs" ''
        mkdir -p "$PWD/data/fake-gcs"

        ${pkgs.fake-gcs-server}/bin/fake-gcs-server \
          -scheme http \
          -host 0.0.0.0 \
          -port 4443 \
          -external-url http://localhost:4443 \
          -filesystem-root "$PWD/data/fake-gcs"
      '');

      readiness_probe = {
        http_get = {
          host = "127.0.0.1";
          port = 4443;
          path = "/storage/v1/b";
        };
        initial_delay_seconds = 2;
        period_seconds = 10;
        timeout_seconds = 3;
        success_threshold = 1;
        failure_threshold = 3;
      };

      namespace = "storage.fake-gcs";
      availability.restart = "on_failure";
    };

    # MinIO — local S3 emulator for STORAGE_PROVIDER=s3 (@xyne/storage).
    # Parity with the compose `minio` service (minioadmin/minioadmin, 9000/9001).
    settings.processes.minio = {
      command = toString (pkgs.writeShellScript "minio" ''
        mkdir -p "$PWD/data/minio"
        export MINIO_ROOT_USER=minioadmin
        export MINIO_ROOT_PASSWORD=minioadmin
        exec ${pkgs.minio}/bin/minio server "$PWD/data/minio" \
          --address :9000 \
          --console-address :9001
      '');

      readiness_probe = {
        http_get = {
          host = "127.0.0.1";
          port = 9000;
          path = "/minio/health/live";
        };
        initial_delay_seconds = 2;
        period_seconds = 10;
        timeout_seconds = 3;
        success_threshold = 1;
        failure_threshold = 3;
      };

      namespace = "storage.minio";
      availability.restart = "on_failure";
    };

    # YSweet Server (collaborative editing) - Native via Nix
    settings.processes.ysweet = {
      command = toString (pkgs.writeShellScript "ysweet" ''
        mkdir -p "$PWD/data/ysweet"

        # Download y-sweet if not present
        YSWEET_DIR="$PWD/.nix-cache/ysweet"
        YSWEET_BIN="$YSWEET_DIR/y-sweet"

        if [ ! -f "$YSWEET_BIN" ]; then
          echo "📦 Downloading y-sweet binary..."
          mkdir -p "$YSWEET_DIR"

          if [[ "$OSTYPE" == "darwin"* ]]; then
            if [[ $(uname -m) == "arm64" ]]; then
              PLATFORM="macos-arm64"
            else
              PLATFORM="macos-x64"
            fi
          else
            if [[ $(uname -m) == "aarch64" ]]; then
              PLATFORM="linux-arm64"
            else
              PLATFORM="linux-x64"
            fi
          fi

          ${pkgs.curl}/bin/curl -L \
            "https://github.com/jamsocket/y-sweet/releases/latest/download/y-sweet-$PLATFORM.gz" \
            -o "$YSWEET_DIR/y-sweet.gz"

          ${pkgs.gzip}/bin/gunzip "$YSWEET_DIR/y-sweet.gz"
          chmod +x "$YSWEET_BIN"
          echo "✓ y-sweet downloaded"
        fi

        # OTEL parity with the compose service
        export Y_SWEET_OTEL_ENDPOINT="''${Y_SWEET_OTEL_ENDPOINT:-http://127.0.0.1:4318/v1/metrics}"
        export Y_SWEET_OTEL_SERVICE_NAME="''${Y_SWEET_OTEL_SERVICE_NAME:-y-sweet}"
        export Y_SWEET_OTEL_PUSH_INTERVAL="''${Y_SWEET_OTEL_PUSH_INTERVAL:-30}"

        "$YSWEET_BIN" serve \
          --host 0.0.0.0 \
          --port 8080 \
          --checkpoint-freq-seconds 10 \
          "$PWD/data/ysweet"
      '');

      readiness_probe = {
        exec.command = "${pkgs.netcat}/bin/nc -z 127.0.0.1 8080";
        initial_delay_seconds = 2;
        period_seconds = 10;
        timeout_seconds = 2;
        success_threshold = 1;
        failure_threshold = 3;
      };

      namespace = "collab.ysweet";
      availability.restart = "on_failure";
    };

    # VictoriaMetrics — metrics store (compose parity: port 8428, 12mo retention)
    settings.processes.victoriametrics = {
      command = toString (pkgs.writeShellScript "victoriametrics" ''
        mkdir -p "$PWD/data/victoriametrics"
        exec ${pkgs.victoriametrics}/bin/victoria-metrics \
          --storageDataPath="$PWD/data/victoriametrics" \
          --httpListenAddr=:8428 \
          --retentionPeriod=12 \
          --promscrape.config="$PWD/scrape.yml"
      '');

      readiness_probe = {
        http_get = { host = "127.0.0.1"; port = 8428; path = "/health"; };
        initial_delay_seconds = 2;
        period_seconds = 10;
        timeout_seconds = 3;
        success_threshold = 1;
        failure_threshold = 3;
      };

      namespace = "monitoring.victoriametrics";
      availability.restart = "on_failure";
    };

    # OpenTelemetry Collector — same config file as compose, with the docker
    # hostname rewritten to loopback for the native process.
    settings.processes.otel-collector = {
      command = toString (pkgs.writeShellScript "otel-collector" ''
        mkdir -p "$PWD/data"
        ${pkgs.gnused}/bin/sed 's/victoriametrics:8428/127.0.0.1:8428/' \
          "$PWD/otelCollector/otel-collector-config.yaml" > "$PWD/data/otel-collector-config.native.yaml"
        exec ${pkgs.opentelemetry-collector-contrib}/bin/otelcol-contrib \
          --config="$PWD/data/otel-collector-config.native.yaml"
      '');

      depends_on = {
        victoriametrics = { condition = "process_healthy"; };
      };

      namespace = "monitoring.otel-collector";
      availability.restart = "on_failure";
    };

    # Grafana — dashboards, provisioned from docker/grafana/provisioning
    settings.processes.grafana = {
      command = toString (pkgs.writeShellScript "grafana" ''
        mkdir -p "$PWD/data/grafana/plugins"
        export GF_SECURITY_ADMIN_USER=admin
        export GF_SECURITY_ADMIN_PASSWORD=admin
        export GF_USERS_ALLOW_SIGN_UP=false
        export GF_SERVER_HTTP_PORT=3333
        export GF_SERVER_ROOT_URL=http://localhost:3333
        export GF_PATHS_DATA="$PWD/data/grafana"
        export GF_PATHS_PLUGINS="$PWD/data/grafana/plugins"
        export GF_PATHS_PROVISIONING="$PWD/docker/grafana/provisioning"
        exec ${pkgs.grafana}/bin/grafana server \
          --homepath ${pkgs.grafana}/share/grafana
      '');

      depends_on = {
        victoriametrics = { condition = "process_healthy"; };
      };

      readiness_probe = {
        http_get = { host = "127.0.0.1"; port = 3333; path = "/api/health"; };
        initial_delay_seconds = 5;
        period_seconds = 10;
        timeout_seconds = 3;
        success_threshold = 1;
        failure_threshold = 5;
      };

      namespace = "monitoring.grafana";
      availability.restart = "on_failure";
    };

    # Superposition — feature flags. Demo image only (no nixpkgs package), so
    # this runs via docker/podman when available and skips otherwise.
    settings.processes.superposition = {
      command = toString (containerFallback "superposition" ''
        -p 9999:8080 \
        -e SUPERPOSITION_TOKEN=123456 \
        -e SUPERPOSITION_ORG_ID=localorg \
        -e SUPERPOSITION_WORKSPACE_ID=test \
        -e REDIS_URL=redis://host.docker.internal:6379 \
        ghcr.io/juspay/superposition-demo:latest
      '');

      depends_on = {
        xyne-redis = { condition = "process_healthy"; };
      };

      namespace = "flags.superposition";
      availability.restart = "on_failure";
    };

    # LiveKit Egress — audio recording. Image-only (GStreamer stack), so same
    # container fallback; hostnames in egress.yaml are rewritten for host networking.
    settings.processes.livekit-egress = {
      command = toString (pkgs.writeShellScript "livekit-egress" ''
        RUNTIME=$(command -v docker || command -v podman || true)
        if [ -z "$RUNTIME" ]; then
          echo "⚠ livekit-egress: docker/podman not found — skipping (container-image-only service)"
          exec tail -f /dev/null
        fi
        mkdir -p "$PWD/data"
        ${pkgs.gnused}/bin/sed \
          -e 's/redis:6379/host.docker.internal:6379/' \
          -e 's/livekit:7880/host.docker.internal:7880/' \
          -e 's|http://fake-gcs:4443|http://host.docker.internal:4443|' \
          "$PWD/docker/egress.yaml" > "$PWD/data/egress.native.yaml"
        "$RUNTIME" rm -f xyne-nix-livekit-egress 2>/dev/null || true
        exec "$RUNTIME" run --rm --name xyne-nix-livekit-egress \
          --add-host host.docker.internal:host-gateway \
          -e EGRESS_CONFIG_FILE=/etc/egress.yaml \
          -e STORAGE_EMULATOR_HOST=http://host.docker.internal:4443 \
          -v "$PWD/data/egress.native.yaml":/etc/egress.yaml \
          mirror.gcr.io/livekit/egress:latest
      '');

      depends_on = {
        xyne-livekit = { condition = "process_healthy"; };
        xyne-redis = { condition = "process_healthy"; };
        fake-gcs = { condition = "process_healthy"; };
      };

      namespace = "media.livekit-egress";
      availability.restart = "on_failure";
    };

    # Python Transcription Agent - Native via Nix Python
    settings.processes.transcription-agent = {
      command = toString (pkgs.writeShellScript "transcription-agent" ''
        cd apps/backend/python-agent
        mkdir -p transcriptions

        export LIVEKIT_URL="ws://127.0.0.1:7880"
        export LIVEKIT_API_KEY="devkey"
        export LIVEKIT_API_SECRET="devsecret"
        export BACKEND_URL="http://127.0.0.1:3001"
        export REDIS_URL="redis://127.0.0.1:6379"
        export REDIS_HOST="127.0.0.1"
        export REDIS_PORT="6379"
        export STORAGE_EMULATOR_HOST="http://127.0.0.1:4443"
        export HEALTH_PORT="8001"

        if [ ! -d ".venv" ]; then
          echo "📦 Creating Python virtual environment..."
          ${pkgs.python3}/bin/python -m venv .venv

          echo "📦 Installing dependencies (this may take a minute)..."
          .venv/bin/pip install --upgrade pip setuptools wheel
          .venv/bin/pip install -r requirements.txt
          echo "✓ Dependencies installed"
        fi

        .venv/bin/python main.py start
      '');

      depends_on = {
        xyne-livekit = { condition = "process_healthy"; };
        xyne-redis = { condition = "process_healthy"; };
        fake-gcs = { condition = "process_healthy"; };
      };

      readiness_probe = {
        http_get = {
          host = "127.0.0.1";
          port = 8001;
          path = "/health";
        };
        initial_delay_seconds = 10;
        period_seconds = 10;
        timeout_seconds = 3;
        success_threshold = 1;
        failure_threshold = 5;
      };

      namespace = "ai.transcription-agent";
      availability.restart = "on_failure";
    };

    # Container infrastructure kept for future use (currently empty)
    containers = { };
  };

  # Custom apps/commands
  apps = {
    # Comprehensive cleanup command
    cleanup = {
      type = "app";
      program = toString (pkgs.writeShellScript "xyne-cleanup" ''
        set -e

        GREEN='\033[0;32m'
        BLUE='\033[0;34m'
        YELLOW='\033[1;33m'
        NC='\033[0m'

        echo -e "''${BLUE}🧹 Starting cleanup...''${NC}"
        echo ""

        # 1. Clean up ports and processes
        echo -e "''${YELLOW}1. Cleaning up ports and processes...''${NC}"
        pkill -f process-compose 2>/dev/null || true

        for port in ${portList}; do
          lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
        done

        # Stop container-fallback services if a runtime is present
        RUNTIME=$(command -v docker || command -v podman || true)
        if [ -n "$RUNTIME" ]; then
          "$RUNTIME" rm -f xyne-nix-superposition xyne-nix-livekit-egress 2>/dev/null || true
        fi
        echo -e "''${GREEN}   ✓ Ports and processes cleaned''${NC}"
        echo ""

        # 2. Clean up Nix data directories
        echo -e "''${YELLOW}2. Cleaning up database volumes...''${NC}"
        if [ -d "data" ]; then
          echo "   Removing data/ directory (PostgreSQL, Redis, Zero, MinIO, Grafana, VM data)..."
          rm -rf data/
          echo -e "''${GREEN}   ✓ data/ removed (databases wiped)''${NC}"
        fi

        if [ -d ".logs" ]; then
          rm -rf .logs/
          echo -e "''${GREEN}   ✓ .logs/ removed''${NC}"
        fi

        if [ -d ".nix-cache" ]; then
          rm -rf .nix-cache/
          echo -e "''${GREEN}   ✓ .nix-cache/ removed (downloaded binaries)''${NC}"
        fi

        if [ -d "apps/backend/python-agent/.venv" ]; then
          rm -rf apps/backend/python-agent/.venv
          echo -e "''${GREEN}   ✓ Python .venv/ removed''${NC}"
        fi
        echo ""

        echo -e "''${YELLOW}⚠️  This is equivalent to 'docker-compose down -v' (volumes removed)''${NC}"
        echo ""
        echo -e "''${GREEN}✅ Cleanup complete!''${NC}"
        echo ""
        echo -e "''${BLUE}Next steps for fresh start:''${NC}"
        echo "  1. Run: nix run .#xyne-space-services"
        echo "  2. Run: pnpm run dev:all (in another terminal)"
        echo "  3. Run: just assign-admin YOUR_EMAIL"
        echo ""
      '');
    };
  };
}
