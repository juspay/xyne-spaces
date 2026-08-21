# Main project configuration for xyne-spaces
# This file contains all the development environment and service configurations
{ pkgs, lib, flakeInputs, ... }:
{
  imports = [
    ./nix/modules/devshell.nix
  ];

  # Development shell configuration
  devShell = {
    name = "xyne-spaces-dev";

    packages = with pkgs; [
      nodejs
      pnpm
      just
    ];

    banner = ''
      # Xyne Spaces Dev Environment

      Node.js: ${pkgs.nodejs.version}

      ## Getting Started

      ```bash
      # Start services (automatically cleans up ports first)
      nix run .#xyne-space-services  # Or, `just services`
      # Run backend
      cd apps/backend && pnpm install && pnpm run dev
      # Run dashboard
      cd apps/dashboard && pnpm install && pnpm run dev
      ```

      ## Cleanup Commands

      ```bash
      # Cleanup ports and database volumes (like docker-compose down -v)
      nix run .#cleanup    # Or, `just cleanup`
      
      # Quick port cleanup only (no database wipe)
      just cleanup-ports
      ```

      ## More info?

      Edit `project.nix` to modify Nix setup.
      Run `just` to see all available commands.
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
      # Cleanup ports before starting services
      echo "🧹 Cleaning up development services..."
      
      # Kill all process-compose instances
      pkill -f process-compose 2>/dev/null || true
      
      # Kill processes on specific ports
      PORTS=(5433 6379 7880 4848 4849 8080 4443 8001)
      for port in "''${PORTS[@]}"; do
        lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
      done
      
      sleep 1
      echo "✓ All development ports are free"
      
      # Create necessary directories
      mkdir -p data/zero-cache data/ysweet data/fake-gcs .logs .nix-cache
    '';

    # Configure log files for all processes
    defaults.processSettings = { name, ... }: {
      log_location = ".logs/${name}.log";
    };

    # Database setup process (runs once after PostgreSQL is ready)
    settings.processes.db-setup = {
      command = toString (pkgs.writeShellScript "db-setup" ''
        set -e  # Exit on error
        set -o pipefail  # Catch errors in pipes
        
        echo "=== Starting database setup process ==="
        echo "PWD: $PWD"
        echo "Checking PostgreSQL health..."
        
        # Wait for PostgreSQL to be ready
        if ! ${pkgs.postgresql}/bin/psql -h 127.0.0.1 -p 5433 -U xyne -d xyne_dev_db -c "SELECT 1;" > /dev/null 2>&1; then
          echo "ERROR: PostgreSQL is not ready"
          exit 1
        fi
        echo "✓ PostgreSQL is healthy"
        
        # Get project root (where we were invoked from)
        PROJECT_ROOT="$PWD"
        BACKEND_DIR="$PROJECT_ROOT/apps/backend"
        
        echo "Project root: $PROJECT_ROOT"
        echo "Backend dir: $BACKEND_DIR"
        
        # Only run setup if backend has dependencies
        if [ ! -d "$BACKEND_DIR/node_modules" ]; then
          echo "Backend dependencies not installed. Skipping database setup."
          echo "Run: cd apps/backend && pnpm install"
          exit 0
        fi
        echo "✓ Backend node_modules found"
        
        cd "$BACKEND_DIR"
        echo "Changed to backend directory"
        
        # Check if users table exists
        echo "Checking if users table exists..."
        USER_COUNT=$(${pkgs.postgresql}/bin/psql -h 127.0.0.1 -p 5433 -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || echo "ERROR")
        USER_COUNT=$(echo "$USER_COUNT" | xargs)
        echo "User count: $USER_COUNT"
        
        if [[ "$USER_COUNT" == *"ERROR"* ]] || [[ "$USER_COUNT" == *"does not exist"* ]] || [ -z "$USER_COUNT" ]; then
          echo "Setting up database from scratch..."
          
          # Drop and recreate database
          ${pkgs.postgresql}/bin/psql -h 127.0.0.1 -p 5433 -U xyne -d postgres -c "DROP DATABASE IF EXISTS xyne_dev_db;" 2>/dev/null || true
          ${pkgs.postgresql}/bin/psql -h 127.0.0.1 -p 5433 -U xyne -d postgres -c "CREATE DATABASE xyne_dev_db;" 2>/dev/null || true
          
          # Push schema
          ${pkgs.nodejs}/bin/pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --force-reset --accept-data-loss --skip-generate
          
          # Seed ACL system
          echo "Seeding ACL system..."
          ${pkgs.nodejs}/bin/pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
          echo "✓ ACL system seeded"
          
          # Auto-create admin user from DEFAULT_ADMIN_EMAIL
          echo ""
          echo "Creating default admin user..."
          ${pkgs.nodejs}/bin/pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-admin-user.ts
          echo ""
          echo "✓ Database setup complete"
        else
          echo "Syncing database schema..."
          ${pkgs.nodejs}/bin/pnpm exec dotenv -e .env.local -- pnpm exec prisma db push
          echo "✓ Database schema is up to date"
        fi
        
        echo "✓ Database ready"
        
        # Keep the process running
        tail -f /dev/null
      '');
      
      depends_on = {
        xyne-db = { condition = "process_healthy"; };
      };
      
      namespace = "setup.db-setup";
      availability.restart = "on_failure";
    };

    # Disable TUI for headless operation
    settings.environment.PC_DISABLE_TUI = "true";

    # PostgreSQL service
    services.postgres."xyne-db" = {
      enable = true;
      listen_addresses = "127.0.0.1";
      port = 5433;

      superuser = "xyne";

      initialDatabases = [
        { name = "xyne_dev_db"; }
      ];

      initialScript.after = ''
        -- Configure for Zero (Change Data Capture)
        ALTER SYSTEM SET wal_level = logical;
        ALTER SYSTEM SET max_replication_slots = 10;
        ALTER SYSTEM SET max_wal_senders = 10;
        SELECT pg_reload_conf();

        -- Grant permissions
        GRANT ALL PRIVILEGES ON DATABASE xyne_dev_db TO xyne;
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

    # Add dependency: zero-cache depends on postgres
    settings.processes."xyne-zero".depends_on."xyne-db".condition = "process_healthy";

    # Fake GCS Server (native Nix package)
    settings.processes.fake-gcs = {
      command = toString (pkgs.writeShellScript "fake-gcs" ''
        # Create data directory
        mkdir -p "$PWD/data/fake-gcs"
        
        # Run fake-gcs-server with absolute path
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
          
          # Detect platform
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
          
          # Download from GitHub releases (note: .gz not .tar.gz)
          ${pkgs.curl}/bin/curl -L \
            "https://github.com/jamsocket/y-sweet/releases/latest/download/y-sweet-$PLATFORM.gz" \
            -o "$YSWEET_DIR/y-sweet.gz"
          
          ${pkgs.gzip}/bin/gunzip "$YSWEET_DIR/y-sweet.gz"
          chmod +x "$YSWEET_BIN"
          echo "✓ y-sweet downloaded"
        fi
        
        # Run y-sweet
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

    # Python Transcription Agent - Native via Nix Python
    settings.processes.transcription-agent = {
      command = toString (pkgs.writeShellScript "transcription-agent" ''
        cd apps/backend/python-agent
        mkdir -p transcriptions
        
        # Set environment variables
        export LIVEKIT_URL="ws://127.0.0.1:7880"
        export LIVEKIT_API_KEY="devkey"
        export LIVEKIT_API_SECRET="devsecret"
        export BACKEND_URL="http://127.0.0.1:3001"
        export REDIS_URL="redis://127.0.0.1:6379"
        export REDIS_HOST="127.0.0.1"
        export REDIS_PORT="6379"
        export STORAGE_EMULATOR_HOST="http://127.0.0.1:4443"
        export HEALTH_PORT="8001"
        
        # Create virtual environment if it doesn't exist
        if [ ! -d ".venv" ]; then
          echo "📦 Creating Python virtual environment..."
          ${pkgs.python3}/bin/python -m venv .venv
          
          echo "📦 Installing dependencies (this may take a minute)..."
          .venv/bin/pip install --upgrade pip setuptools wheel
          .venv/bin/pip install -r requirements.txt
          echo "✓ Dependencies installed"
        fi
        
        # Run the agent using the venv with 'start' command
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
        
        PORTS=(5433 6379 7880 4848 4849 8080 4443 8001)
        for port in "''${PORTS[@]}"; do
          lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
        done
        echo -e "''${GREEN}   ✓ Ports and processes cleaned''${NC}"
        echo ""
        
        # 2. Clean up Nix data directories
        echo -e "''${YELLOW}2. Cleaning up database volumes...''${NC}"
        if [ -d "data" ]; then
          echo "   Removing data/ directory (PostgreSQL, Redis, Zero Cache data)..."
          rm -rf data/
          echo -e "''${GREEN}   ✓ data/ removed (databases wiped)''${NC}"
        fi
        
        if [ -d ".logs" ]; then
          echo "   Removing .logs/ directory..."
          rm -rf .logs/
          echo -e "''${GREEN}   ✓ .logs/ removed''${NC}"
        fi
        
        if [ -d ".nix-cache" ]; then
          echo "   Removing .nix-cache/ directory (downloaded binaries)..."
          rm -rf .nix-cache/
          echo -e "''${GREEN}   ✓ .nix-cache/ removed''${NC}"
        fi
        
        if [ -d "apps/backend/python-agent/.venv" ]; then
          echo "   Removing Python virtual environment..."
          rm -rf apps/backend/python-agent/.venv
          echo -e "''${GREEN}   ✓ Python .venv/ removed''${NC}"
        fi
        echo ""
        
        echo -e "''${YELLOW}⚠️  This is equivalent to 'docker-compose down -v' (volumes removed)''${NC}"
        echo ""
        echo -e "''${GREEN}✅ Cleanup complete!''${NC}"
        echo ""
        echo -e "''${BLUE}What was cleaned:''${NC}"
        echo "  ✓ All service processes and ports"
        echo "  ✓ All database volumes (PostgreSQL, Redis, Zero Cache)"
        echo "  ✓ All service data (YSweet, Fake GCS)"
        echo ""
        echo -e "''${YELLOW}⚠️  All local database data has been wiped!''${NC}"
        echo -e "''${BLUE}Note: node_modules and caches were preserved''${NC}"
        echo ""
        echo -e "''${BLUE}Next steps for fresh start:''${NC}"
        echo "  1. Run: nix run .#xyne-space-services"
        echo "  2. Wait for services to start (~10 seconds)"
        echo "  3. Run: cd apps/backend && pnpm run dev (in another terminal)"
        echo "  4. Run: just assign-admin YOUR_EMAIL"
        echo "  5. Run: cd apps/dashboard && pnpm run dev (in another terminal)"
        echo ""
      '');
    };
  };
}