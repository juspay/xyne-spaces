#!/bin/bash

# Xyne Spaces - Start Infrastructure Services (Docker/Podman)

set -e

echo "🚀 Starting Xyne Spaces Infrastructure Services..."
echo ""

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check and stop local PostgreSQL if running on port 5432
echo -e "${BLUE}Checking for local PostgreSQL on port 5432...${NC}"
if lsof -Pi :5432 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}⚠️  Local PostgreSQL detected on port 5432${NC}"
    echo -e "${YELLOW}   Attempting to stop it...${NC}"

    # Try brew services stop first (most common on macOS)
    if command -v brew &> /dev/null && brew services list | grep -q "postgresql.*started"; then
        brew services stop postgresql 2>/dev/null || true
        echo -e "${GREEN}✓ Stopped local PostgreSQL via brew${NC}"
    # Try pg_ctl stop
    elif command -v pg_ctl &> /dev/null; then
        pg_ctl -D /usr/local/var/postgres stop 2>/dev/null || \
        pg_ctl -D ~/Library/Application\ Support/Postgres/var-* stop 2>/dev/null || true
        echo -e "${GREEN}✓ Stopped local PostgreSQL via pg_ctl${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not stop local PostgreSQL automatically${NC}"
        echo -e "${YELLOW}   Please stop it manually: brew services stop postgresql${NC}"
        echo -e "${YELLOW}   Or kill the process: lsof -ti:5432 | xargs kill -9${NC}"
    fi

    sleep 2
else
    echo -e "${GREEN}✓ No local PostgreSQL running on port 5432${NC}"
fi

# Detect container runtime
CONTAINER_RUNTIME=""
COMPOSE_CMD=""

if command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    if ! docker info > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Docker is installed but not running. Trying Podman...${NC}"
        CONTAINER_RUNTIME=""
    else
        echo -e "${GREEN}✓ Using Docker${NC}"
    fi
fi

if [ -z "$CONTAINER_RUNTIME" ] && command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"

    # Check if podman-compose is installed
    if ! command -v podman-compose &> /dev/null; then
        echo -e "${YELLOW}⚠️  podman-compose not found. Installing it...${NC}"
        INSTALLED=false
        if command -v pip3 &> /dev/null; then
            pip3 install --user podman-compose 2>/dev/null && INSTALLED=true || \
            pip3 install podman-compose 2>/dev/null && INSTALLED=true || true
        fi
        if [ "$INSTALLED" = false ] && command -v brew &> /dev/null; then
            echo -e "${YELLOW}⚠️  pip3 install failed, trying brew...${NC}"
            brew install podman-compose && INSTALLED=true || true
        fi
        if [ "$INSTALLED" = false ]; then
            echo -e "${RED}❌ Cannot install podman-compose. Please install it manually.${NC}"
            echo -e "${YELLOW}   Falling back to 'podman compose'${NC}"
            COMPOSE_CMD="podman compose"
        fi
    fi

    if command -v podman-compose &> /dev/null; then
        COMPOSE_CMD="podman-compose"
    else
        COMPOSE_CMD="podman compose"
    fi

    # Check if podman machine is running
    if ! podman machine list 2>/dev/null | grep -qi "running"; then
        echo -e "${YELLOW}⚠️  Podman machine not running. Starting default machine...${NC}"
        podman machine start 2>/dev/null || {
            echo -e "${YELLOW}⚠️  Machine may already exist. Trying init...${NC}"
            podman machine init 2>/dev/null && podman machine start
        } || true
        echo -e "${GREEN}✓ Podman machine started${NC}"
    fi

    echo -e "${GREEN}✓ Using Podman${NC}"
fi

if [ -z "$CONTAINER_RUNTIME" ]; then
    echo -e "${RED}❌ No container runtime available. Please start Docker/OrbStack or install Podman.${NC}"
    exit 1
fi

# Start infrastructure services
echo -e "${BLUE}🚢 Starting infrastructure services...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d postgres common-postgres redis livekit fake-gcs minio ysweet transcription-agent victoriametrics grafana otel-collector superposition

# Start Vespa now so it boots (~1 min) in parallel with the database work below.
# It lives in its own compose file with its own data volume; schemas are deployed
# at the end of this script. Set SKIP_VESPA=1 to leave search out entirely.
VESPA_COMPOSE="vespa-core/deployment/docker-compose.dev.yml"
# -p is required: compose would otherwise name the project after the compose file's
# parent dir ("deployment") and split Vespa off from the rest of the stack. This is
# the same project name the root compose file resolves to.
VESPA_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
if [ "${SKIP_VESPA:-0}" = "1" ]; then
    echo -e "${YELLOW}⏭  Skipping Vespa (SKIP_VESPA=1)${NC}"
elif [ ! -f "$VESPA_COMPOSE" ]; then
    echo -e "${YELLOW}⚠️  $VESPA_COMPOSE not found, skipping Vespa${NC}"
    SKIP_VESPA=1
else
    echo -e "${BLUE}🔎 Starting Vespa...${NC}"
    if $COMPOSE_CMD -p "$VESPA_PROJECT" -f "$VESPA_COMPOSE" up -d; then
        echo -e "${GREEN}✓ Vespa container started${NC}"
    else
        echo -e "${YELLOW}⚠️  Vespa failed to start (continuing without search)${NC}"
        SKIP_VESPA=1
    fi
fi

# Wait for PostgreSQL
echo -e "${BLUE}⏳ Waiting for PostgreSQL...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f docker-compose.dev.yml exec -T postgres pg_isready -U xyne -d xyne_dev_db > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ PostgreSQL failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Wait for common PostgreSQL
echo -e "${BLUE}⏳ Waiting for common PostgreSQL...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f docker-compose.dev.yml exec -T common-postgres pg_isready -U xyne -d xyne_common > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Common PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Common PostgreSQL failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Wait for Redis
echo -e "${BLUE}⏳ Waiting for Redis...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f docker-compose.dev.yml exec -T redis redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Redis is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Redis failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Wait for fake-gcs-server
echo -e "${BLUE}⏳ Waiting for fake-gcs-server...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:4443/storage/v1/b > /dev/null 2>&1; then
        echo -e "${GREEN}✓ fake-gcs-server is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}⚠️  fake-gcs-server failed to start (optional service)${NC}"
        break
    fi
    sleep 1
done

# Wait for MinIO
echo -e "${BLUE}⏳ Waiting for MinIO...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        echo -e "${GREEN}✓ MinIO is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}⚠️  MinIO failed to start (optional service)${NC}"
        break
    fi
    sleep 1
done

# Setup fake-gcs buckets
if curl -s http://localhost:4443/storage/v1/b > /dev/null 2>&1; then
    echo -e "${BLUE}📦 Setting up fake-gcs buckets...${NC}"

    # Create frontend bundles bucket
    curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
      -H "Content-Type: application/json" \
      -d '{"name":"xyne-frontend-bundles"}' > /dev/null 2>&1

    # Create chat documents bucket
    curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
      -H "Content-Type: application/json" \
      -d '{"name":"xyne-spaces-chat-documents"}' > /dev/null 2>&1

    # Create transcription bucket
    curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
      -H "Content-Type: application/json" \
      -d '{"name":"transcription-dev-v2"}' > /dev/null 2>&1

    # Create canvas documents bucket
    curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
      -H "Content-Type: application/json" \
      -d '{"name":"xyne-spaces-canvas-documents"}' > /dev/null 2>&1

    echo -e "${GREEN}✓ fake-gcs buckets created (xyne-frontend-bundles, xyne-spaces-chat-documents, transcription-dev-v2, xyne-spaces-canvas-documents)${NC}"
fi

# Run database migrations
echo -e "${BLUE}🔄 Setting up database schema...${NC}"
cd backend

# Create .env.local from .env.example if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  backend/.env.local not found. Creating from .env.example...${NC}"
    cp .env.example .env.local
    echo -e "${GREEN}✓ Created backend/.env.local${NC}"
    node ../scripts/generate-local-secrets.mjs
    echo -e "${YELLOW}   Please review and update values as needed.${NC}"
fi

# Export key env vars from .env.local to ensure prisma/node use correct values
# (dotenv -e sometimes fails to override shell/env values)
export_database_url() {
    var_name="$1"
    value=$(grep "^${var_name}=" .env.local 2>/dev/null | sed "s/^${var_name}=//" | tail -n 1)
    if [ -n "$value" ]; then
        export "$var_name=$value"
    fi
}
export_database_url "DATABASE_URL"
export_database_url "COMMON_DATABASE_URL"
export_database_url "ZERO_UPSTREAM_DB"
echo -e "${BLUE}   DATABASE_URL: ${DATABASE_URL}${NC}"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}⚠️  Backend dependencies not installed.${NC}"
  echo -e "${YELLOW}   Skipping database setup. Please run:${NC}"
  echo -e "${YELLOW}   1. cd backend && npm install${NC}"
  echo -e "${YELLOW}   2. npm run services (to setup database)${NC}"
  cd ..
else
  # Check if users table exists by trying to query it (Prisma creates lowercase table names)
  USER_COUNT=$($COMPOSE_CMD -f ../docker-compose.dev.yml exec -T postgres psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || true)
  echo "DEBUG: User count query result: '$USER_COUNT'"
  USER_COUNT=$(echo "$USER_COUNT" | xargs)

  if [ -z "$USER_COUNT" ] || [[ "$USER_COUNT" == *"ERROR"* ]] || [[ "$USER_COUNT" == *"does not exist"* ]]; then
    # First run - User table doesn't exist, need to set up everything
    echo -e "${YELLOW}⚠️  User table doesn't exist. Setting up database from scratch...${NC}"

    # Stop zero-cache and clear its cache
    echo -e "${BLUE}🛑 Stopping zero-cache and clearing cache...${NC}"
    $COMPOSE_CMD -f ../docker-compose.dev.yml stop zero-cache 2>/dev/null || true
    $COMPOSE_CMD -f ../docker-compose.dev.yml rm -f zero-cache 2>/dev/null || true
    docker volume rm xyne-spaces_zero_cache_data 2>/dev/null || podman volume rm xyne-spaces_zero_cache_data 2>/dev/null || true

    # Drop and recreate database
    echo -e "${BLUE}Dropping and recreating database...${NC}"
    $COMPOSE_CMD -f ../docker-compose.dev.yml exec -T postgres psql -U xyne -d postgres -c "DROP DATABASE IF EXISTS xyne_dev_db;" 2>/dev/null
    $COMPOSE_CMD -f ../docker-compose.dev.yml exec -T postgres psql -U xyne -d postgres -c "CREATE DATABASE xyne_dev_db;" 2>/dev/null

    # Push schema with force-reset (first time setup - ensures tables are created)
    echo -e "${BLUE}Creating database schema...${NC}"
    npx dotenv -e .env.local -- npx prisma db push --force-reset --accept-data-loss --skip-generate

    # Push common database schema (common DB lives in its own Postgres instance)
    echo -e "${BLUE}Creating common database schema...${NC}"
    npx dotenv -e .env.local -- npx prisma db push --schema prisma-common/schema.prisma --force-reset --accept-data-loss --skip-generate

    # Regenerate Prisma client to ensure it matches the current schema
    echo -e "${BLUE}Generating Prisma client...${NC}"
    npx prisma generate
    npx prisma generate --schema prisma-common/schema.prisma
    echo -e "${GREEN}✓ Prisma client generated${NC}"

    # Seed ACL system
    echo -e "${BLUE}🌱 Seeding ACL system...${NC}"
    npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts
    echo -e "${GREEN}✓ ACL system seeded${NC}"

    # Create developer user (uses DEFAULT_ADMIN_EMAIL from .env.local)
    echo -e "${BLUE}Creating developer user...${NC}"
    npx dotenv -e .env.local -- npx tsx scripts/assign-user-group.ts
    echo -e "${GREEN}✓ Developer user created${NC}"
  else
    # User table exists - just sync schema changes without dropping data
    echo -e "${BLUE}Syncing database schema...${NC}"
    npx dotenv -e .env.local -- npx prisma db push

    # Sync common database schema (common DB lives in its own Postgres instance)
    echo -e "${BLUE}Syncing common database schema...${NC}"
    npx dotenv -e .env.local -- npx prisma db push --schema prisma-common/schema.prisma --accept-data-loss --skip-generate
    npx prisma generate --schema prisma-common/schema.prisma
    echo -e "${GREEN}✓ Database schema is up to date${NC}"

    # Check if default workspace exists, create if not
    echo -e "${BLUE}🔍 Checking for default workspace...${NC}"
    WORKSPACE_EXISTS=$($COMPOSE_CMD -f ../docker-compose.dev.yml exec -T postgres psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
    
    if [ "$WORKSPACE_EXISTS" = "0" ] || [ -z "$WORKSPACE_EXISTS" ]; then
      echo -e "${YELLOW}⚠️  Default workspace not found. Running seed...${NC}"
      npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts
      echo -e "${GREEN}✓ ACL system seeded${NC}"
    else
      echo -e "${GREEN}✓ Default workspace exists${NC}"
    fi
  fi

  echo -e "${GREEN}✓ Database ready${NC}"
  cd ..
fi

# Start zero-cache
echo -e "${BLUE}🚀 Starting zero-cache...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d zero-cache

# Wait for zero-cache
echo -e "${BLUE}⏳ Waiting for Zero cache...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f docker-compose.dev.yml logs zero-cache 2>&1 | grep -q "zero-cache ready"; then
        echo -e "${GREEN}✓ Zero cache is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}⚠ Zero cache taking longer than expected, continuing...${NC}"
        break
    fi
    sleep 1
done

# Start claw-auth-postgres
echo -e "${BLUE}🚢 Starting claw-auth-postgres...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d claw-auth-postgres

echo -e "${BLUE}⏳ Waiting for claw-auth-postgres...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f docker-compose.dev.yml exec -T claw-auth-postgres pg_isready -U claw -d claw_auth_db > /dev/null 2>&1; then
        echo -e "${GREEN}✓ claw-auth-postgres is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ claw-auth-postgres failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Setup kata-sdk (dependency of xyne-claw-shared)
echo -e "${BLUE}🔧 Setting up kata-sdk...${NC}"
if [ -d "packages/kata-sdk" ] && [ ! -d "packages/kata-sdk/node_modules" ]; then
    cd packages/kata-sdk
    echo -e "${YELLOW}⚠️  kata-sdk dependencies not installed. Running npm install...${NC}"
    npm install
    echo -e "${GREEN}✓ kata-sdk ready${NC}"
    cd ../..
fi

# Setup xyne-claw-shared (shared dependency for xyne-claw and xyne-claw-auth)
echo -e "${BLUE}🔧 Setting up xyne-claw-shared...${NC}"
if [ -d "xyne-claw-shared" ] && [ ! -d "xyne-claw-shared/node_modules" ]; then
    cd xyne-claw-shared
    echo -e "${YELLOW}⚠️  xyne-claw-shared dependencies not installed. Running npm install...${NC}"
    npm install
    echo -e "${GREEN}✓ xyne-claw-shared ready${NC}"
    cd ..
fi

# Setup xyne-claw-auth backend
echo -e "${BLUE}🔧 Setting up xyne-claw-auth backend...${NC}"
if [ ! -f "xyne-claw-auth/backend/.env" ]; then
    echo -e "${YELLOW}⚠️  xyne-claw-auth/backend/.env not found. Creating from .env.example...${NC}"
    cp xyne-claw-auth/backend/.env.example xyne-claw-auth/backend/.env
    echo -e "${GREEN}✓ Created xyne-claw-auth/backend/.env${NC}"
    echo -e "${YELLOW}   Please review and update values as needed.${NC}"
fi

# Ensure SPACES_DB_URL is set in claw-auth .env (links claw-auth to Spaces DB for JIT user mirroring)
if ! grep -q "^SPACES_DB_URL=" xyne-claw-auth/backend/.env 2>/dev/null; then
    echo 'SPACES_DB_URL=postgresql://xyne:xyne123@localhost:5433/xyne_dev_db' >> xyne-claw-auth/backend/.env
    echo -e "${GREEN}✓ Added SPACES_DB_URL to xyne-claw-auth/backend/.env${NC}"
fi

if [ -f "xyne-claw-auth/backend/.env" ]; then
    echo -e "${BLUE}🔄 Setting up xyne-claw-auth database schema...${NC}"
    cd xyne-claw-auth/backend
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  xyne-claw-auth/backend dependencies not installed. Running npm install...${NC}"
        npm install
    fi
    set -a && source .env && set +a
    # Pass through DEFAULT_ADMIN_EMAIL from the main backend .env.local if not set locally
    if [ -z "$DEFAULT_ADMIN_EMAIL" ]; then
      export DEFAULT_ADMIN_EMAIL=$(grep -m 1 '^DEFAULT_ADMIN_EMAIL=' ../../backend/.env.local 2>/dev/null | sed 's/^DEFAULT_ADMIN_EMAIL=//' || echo "admin@example.in")
    fi
    npx prisma db push --skip-generate --accept-data-loss
    npx prisma generate
    NODE_OPTIONS="" npx tsx prisma/seed.ts
    echo -e "${GREEN}✓ xyne-claw-auth database schema ready${NC}"
    cd ../..
fi

# Setup xyne-claw-auth frontend
echo -e "${BLUE}🔧 Setting up xyne-claw-auth frontend...${NC}"
if [ -d "xyne-claw-auth/frontend" ]; then
    cd xyne-claw-auth/frontend
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  xyne-claw-auth/frontend dependencies not installed. Running npm install...${NC}"
        npm install
    fi
    echo -e "${GREEN}✓ xyne-claw-auth frontend ready${NC}"
    cd ../..
fi

# Setup xyne-claw
echo -e "${BLUE}🔧 Setting up xyne-claw...${NC}"
if [ ! -f "xyne-claw/.env" ]; then
    echo -e "${YELLOW}⚠️  xyne-claw/.env not found. Creating from .env.example...${NC}"
    cp xyne-claw/.env.example xyne-claw/.env
    echo -e "${GREEN}✓ Created xyne-claw/.env${NC}"
    echo -e "${YELLOW}   Please review and update values as needed.${NC}"
fi

if [ -d "xyne-claw" ]; then
    cd xyne-claw
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  xyne-claw dependencies not installed. Running npm install...${NC}"
        npm install
    fi
    echo -e "${GREEN}✓ xyne-claw ready${NC}"
    cd ..
fi

# Deploy Vespa schemas (idempotent: waits for health, downloads the embedding
# model once, builds the application package, then activates it on the config
# server — via the vespa CLI when installed, otherwise a plain curl upload).
# Non-fatal on purpose: a dev without search should still get a working stack.
VESPA_READY=0
if [ "${SKIP_VESPA:-0}" != "1" ]; then
    echo -e "${BLUE}🔎 Deploying Vespa schemas (first run downloads the embedding model)...${NC}"
    if DOCKER_COMPOSE="$COMPOSE_CMD" CONTAINER_CLI="$CONTAINER_RUNTIME" ./vespa-core/scripts/deploy-dev.sh; then
        echo -e "${GREEN}✓ Vespa schemas deployed${NC}"
        VESPA_READY=1
    else
        echo -e "${YELLOW}⚠️  Vespa schema deploy failed — search will not work.${NC}"
        echo -e "${YELLOW}   Needs curl plus either zip or python3 (all usually present).${NC}"
        echo -e "${YELLOW}   Retry on its own with: ${BLUE}npm run services:vespa${NC}"
    fi
fi

# Deploy Vespa schemas (idempotent: waits for health, downloads the embedding
# model once, builds the application package, then activates it on the config
# server — via the vespa CLI when installed, otherwise a plain curl upload).
# Non-fatal on purpose: a dev without search should still get a working stack.
VESPA_READY=0
if [ "${SKIP_VESPA:-0}" != "1" ]; then
    echo -e "${BLUE}🔎 Deploying Vespa schemas (first run downloads the embedding model)...${NC}"
    if DOCKER_COMPOSE="$COMPOSE_CMD" CONTAINER_CLI="$CONTAINER_RUNTIME" ./vespa-core/scripts/deploy-dev.sh; then
        echo -e "${GREEN}✓ Vespa schemas deployed${NC}"
        VESPA_READY=1
    else
        echo -e "${YELLOW}⚠️  Vespa schema deploy failed — search will not work.${NC}"
        echo -e "${YELLOW}   Needs curl plus either zip or python3 (all usually present).${NC}"
        echo -e "${YELLOW}   Retry on its own with: ${BLUE}npm run services:vespa${NC}"
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Infrastructure Services Running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo -e "  🗄️  PostgreSQL:         ${GREEN}localhost:5433${NC}"
echo -e "  💾 Redis:              ${GREEN}localhost:6379${NC}"
echo -e "  🎥 LiveKit:            ${GREEN}http://localhost:7880${NC}"
echo -e "  📝 Y-Sweet:            ${GREEN}http://localhost:8080${NC}"
echo -e "  ⚡ Zero Server:        ${GREEN}http://localhost:4848${NC}"
echo -e "  📦 fake-gcs:           ${GREEN}http://localhost:4443${NC}"
echo -e "  🪣  MinIO (S3):         ${GREEN}http://localhost:9000${NC} (console: ${GREEN}http://localhost:9001${NC})"
echo -e "  📊 Grafana:            ${GREEN}http://localhost:3333${NC}"
echo -e "  📈 VM:                 ${GREEN}http://localhost:8428${NC}"
echo -e "  🔭 OTEL:               ${GREEN}http://localhost:4318${NC}"
echo -e "  🚩 Superposition:      ${GREEN}http://localhost:9999${NC}"
echo -e "  🗄️  Common PostgreSQL:   ${GREEN}localhost:5434${NC}"
echo -e "  🗄️  claw-auth-postgres: ${GREEN}localhost:5435${NC}"
if [ "$VESPA_READY" = "1" ]; then
    echo -e "  🔎 Vespa feed:         ${GREEN}http://localhost:${VESPA_FEED_PORT:-8083}${NC}"
    echo -e "  🔎 Vespa query:        ${GREEN}http://localhost:${VESPA_QUERY_PORT:-8081}${NC}"
    echo -e "  🔎 Vespa admin:        ${GREEN}http://localhost:19071${NC}"
elif [ "${SKIP_VESPA:-0}" != "1" ]; then
    echo -e "  🔎 Vespa:              ${YELLOW}started, schemas NOT deployed${NC}"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  Backend:        ${BLUE}cd backend && npm run dev${NC}"
echo -e "  Frontend:       ${BLUE}cd dashboard && npm run dev${NC}"
echo -e "  XyneClaw:       ${BLUE}cd xyne-claw && npm run dev${NC}"
echo -e "  Claw auth:      ${BLUE}cd xyne-claw-auth/backend && npm run dev${NC}"
echo -e "  Claw auth UI:   ${BLUE}cd xyne-claw-auth/frontend && npm run dev${NC}"
echo ""
echo -e "${YELLOW}To stop services:${NC}"
echo -e "  ${BLUE}$COMPOSE_CMD -f docker-compose.dev.yml down${NC}"
echo ""

# Read dev user email from .env.local for credentials display
DEV_EMAIL=$(grep -m 1 '^DEFAULT_ADMIN_EMAIL=' backend/.env.local 2>/dev/null | sed 's/^DEFAULT_ADMIN_EMAIL=//' || true)
if [ -z "$DEV_EMAIL" ] || [[ "$DEV_EMAIL" == definition* ]]; then
    DEV_EMAIL="admin@xyne.ai"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🔐 Local Dev Login Credentials${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  ${BLUE}Email:${NC}     ${DEV_EMAIL}"
echo -e "  ${BLUE}Password:${NC}  ${GREEN}xynelocal@123${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}💡 Tip: update DEFAULT_ADMIN_EMAIL in backend/.env.local and re-run 'npm run services' to use your own email.${NC}"
echo ""
