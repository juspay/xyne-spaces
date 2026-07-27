#!/bin/bash

# Minimal Windows Infrastructure Script for Podman
# Run this in Git Bash

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting Infrastructure Services (Windows/Podman Mode)...${NC}"

# --- STEP 1: Handle Port 5432 (Postgres) ---
# We use Windows 'netstat' and 'taskkill' instead of Unix 'lsof'/'kill'
echo -e "${BLUE}Checking for conflicting Postgres on port 5432...${NC}"

# Find PID using netstat (Windows native), filter with grep
PID=$(netstat -ano | grep ":5432 " | grep "LISTEN" | awk '{print $5}' | head -n 1)

if [ -n "$PID" ]; then
    echo -e "${YELLOW}⚠️  Found process $PID on port 5432. Killing it...${NC}"
    # usage of // is specific to Git Bash to prevent path conversion issues with windows flags
    taskkill //F //PID "$PID" >/dev/null 2>&1 || true 
    echo -e "${GREEN}✓ Port 5432 cleared.${NC}"
else
    echo -e "${GREEN}✓ Port 5432 is free.${NC}"
fi

# --- STEP 2: Start Podman Machine (if needed) ---
# Only needed if you are using Podman Desktop's VM
if podman machine list 2>/dev/null | grep -q "Stopped"; then
    echo -e "${YELLOW}Starting Podman Machine...${NC}"
    podman machine start
fi

# --- STEP 3: Start Containers ---
# Currently assumes 'podman compose' works. If not, change to 'podman-compose'
COMPOSE_CMD="podman compose" 

echo -e "${BLUE}🚢 Starting containers...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d postgres redis livekit fake-gcs ysweet transcription-agent victoriametrics grafana otel-collector superposition

# Vespa lives in its own compose file. Set SKIP_VESPA=1 to leave search out.
VESPA_COMPOSE="vespa-core/deployment/docker-compose.dev.yml"
# -p keeps Vespa in the same compose project as the rest of the stack; without it
# compose names the project after the compose file's parent dir ("deployment").
VESPA_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
if [ "${SKIP_VESPA:-0}" != "1" ] && [ -f "$VESPA_COMPOSE" ]; then
    echo -e "${BLUE}🔎 Starting Vespa...${NC}"
    $COMPOSE_CMD -p "$VESPA_PROJECT" -f "$VESPA_COMPOSE" up -d || echo -e "${YELLOW}⚠️  Vespa failed to start (continuing)${NC}"
fi

# --- STEP 4: Wait for Services ---

# Wait for Postgres
echo -e "${BLUE}⏳ Waiting for PostgreSQL...${NC}"
until $COMPOSE_CMD -f docker-compose.dev.yml exec -T postgres pg_isready -U xyne -d xyne_dev_db > /dev/null 2>&1; do
    printf "."
    sleep 2
done
echo -e " ${GREEN}✓ Ready${NC}"

# Wait for fake-gcs-server (using curl from Windows)
echo -e "${BLUE}⏳ Waiting for Fake GCS...${NC}"
until curl -s http://localhost:4443/storage/v1/b > /dev/null 2>&1; do
    printf "."
    sleep 2
done
echo -e " ${GREEN}✓ Ready${NC}"

# --- STEP 5: Setup Buckets ---
echo -e "${BLUE}📦 Creating GCS buckets...${NC}"
curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" -H "Content-Type: application/json" -d '{"name":"xyne-frontend-bundles"}' > /dev/null
curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" -H "Content-Type: application/json" -d '{"name":"xyne-spaces-chat-documents"}' > /dev/null
curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" -H "Content-Type: application/json" -d '{"name":"transcription-dev-v2"}' > /dev/null
curl -s -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" -H "Content-Type: application/json" -d '{"name":"xyne-spaces-canvas-documents"}' > /dev/null
echo -e "${GREEN}✓ Buckets created.${NC}"

# --- STEP 6: Database Setup ---
echo -e "${BLUE}🔄 Checking Database Schema...${NC}"
cd backend

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Installing backend dependencies...${NC}"
    npm install
fi

# We use 'call' logic implicitly by running npx. 
# If database is empty, we force push.
echo -e "${BLUE}Pushing Prisma Schema...${NC}"
npx dotenv -e .env.local -- npx prisma db push

echo -e "${BLUE}🌱 Seeding ACL...${NC}"
npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts

# Optional: Prompt for user creation (Simplified)
# You can uncomment this if you need it interactively
# read -p "Enter email for dev user (or press enter to skip): " USER_EMAIL
# if [ -n "$USER_EMAIL" ]; then
#    npx dotenv -e .env.local -- npx tsx scripts/assign-user-group.ts "$USER_EMAIL"
# fi

cd ..

# --- STEP 7: Start Zero Cache ---
echo -e "${BLUE}🚀 Starting Zero Cache...${NC}"
$COMPOSE_CMD -f docker-compose.dev.yml up -d zero-cache

# --- STEP 8: Deploy Vespa schemas ---
# Non-fatal: needs bun + the vespa CLI. Retry with `npm run services:vespa`.
if [ "${SKIP_VESPA:-0}" != "1" ] && [ -f "$VESPA_COMPOSE" ]; then
    echo -e "${BLUE}🔎 Deploying Vespa schemas...${NC}"
    if DOCKER_COMPOSE="$COMPOSE_CMD" CONTAINER_CLI="podman" bash vespa-core/scripts/deploy-dev.sh; then
        echo -e "${GREEN}✓ Vespa schemas deployed${NC}"
    else
        echo -e "${YELLOW}⚠️  Vespa schema deploy failed — needs bun + vespa CLI.${NC}"
        echo -e "${YELLOW}   Retry with: npm run services:vespa${NC}"
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Windows Infrastructure Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e " 🗄️  PostgreSQL:   ${GREEN}localhost:5432${NC}"
echo -e " 💾 Redis:        ${GREEN}localhost:6379${NC}"
echo -e " 🎥 LiveKit:      ${GREEN}http://localhost:7880${NC}"
echo -e " 📦 fake-gcs:     ${GREEN}http://localhost:4443${NC}"
echo ""