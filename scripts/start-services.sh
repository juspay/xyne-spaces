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

if command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"

    # Check if podman-compose is installed
    if ! command -v podman-compose &> /dev/null; then
        echo -e "${YELLOW}⚠️  podman-compose not found. Installing it...${NC}"
        if command -v pip3 &> /dev/null; then
            pip3 install podman-compose
        elif command -v brew &> /dev/null; then
            brew install podman-compose
        else
            echo -e "${RED}❌ Cannot install podman-compose. Please install pip3 or brew.${NC}"
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
    if ! podman machine list 2>/dev/null | grep -q "Currently running"; then
        echo -e "${YELLOW}⚠️  Podman machine not running. Starting default machine...${NC}"
        podman machine start 2>/dev/null || podman machine init && podman machine start
        echo -e "${GREEN}✓ Podman machine started${NC}"
    fi

    echo -e "${GREEN}✓ Using Podman${NC}"
elif command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}❌ Docker is not running. Please start Docker Desktop and try again.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Using Docker${NC}"
else
    echo -e "${RED}❌ Neither Docker nor Podman found. Please install one of them.${NC}"
    exit 1
fi

# Start infrastructure services
echo -e "${BLUE}🚢 Starting infrastructure services...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d postgres redis livekit fake-gcs ysweet transcription-agent victoriametrics grafana otel-collector superposition

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

    # Seed ACL system
    echo -e "${BLUE}🌱 Seeding ACL system...${NC}"
    npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts
    echo -e "${GREEN}✓ ACL system seeded${NC}"

    # Prompt for developer user
    echo -e "${YELLOW}📧 Please enter your email to create a developer user:${NC}"
    read -p "Email: " USER_EMAIL

    if [ -n "$USER_EMAIL" ]; then
      echo -e "${BLUE}Creating developer user for ${USER_EMAIL}...${NC}"
      npx dotenv -e .env.local -- npx tsx scripts/assign-user-group.ts "$USER_EMAIL"
      echo -e "${GREEN}✓ Developer user created${NC}"
    else
      echo -e "${YELLOW}⚠️  Skipping user creation (no email provided)${NC}"
    fi
  else
    # User table exists - just sync schema changes without dropping data
    echo -e "${BLUE}Syncing database schema...${NC}"
    npx dotenv -e .env.local -- npx prisma db push
    echo -e "${GREEN}✓ Database schema is up to date${NC}"
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

# Setup xyne-claw-auth database schema
if [ -f "xyne-claw-auth/backend/.env" ]; then
    echo -e "${BLUE}🔄 Setting up xyne-claw-auth database schema...${NC}"
    cd xyne-claw-auth/backend
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  xyne-claw-auth/backend dependencies not installed. Running npm install...${NC}"
        npm install
    fi
    set -a && source .env && set +a
    npx prisma db push --skip-generate --accept-data-loss
    npx prisma generate
    NODE_OPTIONS="" npx tsx prisma/seed.ts
    echo -e "${GREEN}✓ xyne-claw-auth database schema ready${NC}"
    cd ../..
else
    echo -e "${YELLOW}⚠️  xyne-claw-auth/backend/.env not found, skipping schema setup${NC}"
    echo -e "${YELLOW}   Run: cp xyne-claw-auth/backend/.env.example xyne-claw-auth/backend/.env${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Infrastructure Services Running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo -e "  🗄️  PostgreSQL:         ${GREEN}localhost:5432${NC}"
echo -e "  💾 Redis:              ${GREEN}localhost:6379${NC}"
echo -e "  🎥 LiveKit:            ${GREEN}http://localhost:7880${NC}"
echo -e "  📝 Y-Sweet:            ${GREEN}http://localhost:8080${NC}"
echo -e "  ⚡ Zero Server:        ${GREEN}http://localhost:4848${NC}"
echo -e "  📦 fake-gcs:           ${GREEN}http://localhost:4443${NC}"
echo -e "  📊 Grafana:            ${GREEN}http://localhost:3333${NC}"
echo -e "  📈 VM:                 ${GREEN}http://localhost:8428${NC}"
echo -e "  🔭 OTEL:               ${GREEN}http://localhost:4318${NC}"
echo -e "  🚩 Superposition:      ${GREEN}http://localhost:9999${NC}"
echo -e "  🗄️  claw-auth-postgres: ${GREEN}localhost:5434${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  Backend:        ${BLUE}cd backend && npm run dev${NC}"
echo -e "  Frontend:       ${BLUE}cd dashboard && npm run dev${NC}"
echo -e "  Claw auth:      ${BLUE}cd xyne-claw-auth/backend && npm run dev${NC}"
echo -e "  Claw auth UI:   ${BLUE}cd xyne-claw-auth/frontend && npm run dev${NC}"
echo ""
echo -e "${YELLOW}To stop services:${NC}"
echo -e "  ${BLUE}$COMPOSE_CMD -f docker-compose.dev.yml down${NC}"
echo ""
