#!/bin/bash

# Xyne Spaces — Local Dev Infrastructure with Interactive Feature Selection
#
# Instead of starting ~16 containers at once, this script asks the developer
# which features they need and starts only the relevant services inside a
# single consolidated dev-infra container (+ separate containers for calls,
# search, and feature-flags if selected).
#
# Feature → service mapping:
#   Chat & Tickets  (always on)  → postgres + redis + zero-cache + fake-gcs + minio
#   Xyne-Claw                    → uses consolidated postgres (no extra container)
#   Canvas                       → y-sweet (inside dev-infra)
#   Calls                        → livekit + transcription-agent + egress (3 containers)
#   Search                       → vespa (1 container)
#   Observability                → otel + victoriametrics + grafana (inside dev-infra)
#   Feature Flags                → superposition (1 container)

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "🚀 Starting Xyne Spaces Infrastructure Services..."
echo ""

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

COMPOSE_FILE="docker-compose.local.yml"

# Bound every health-poll curl. Without this, a port that accepts the connection but
# never answers (e.g. a stale forwarder from another container runtime squatting on it)
# blocks curl forever and the retry loop below never gets to iterate or time out.
CURL_TIMEOUT="--connect-timeout 3 --max-time 5"

# =============================================================================
# 1. Check for local PostgreSQL on port 5432
# =============================================================================
echo -e "${BLUE}Checking for local PostgreSQL on port 5432...${NC}"
if lsof -Pi :5432 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}  Local PostgreSQL detected on port 5432${NC}"
    echo -e "${YELLOW}  Attempting to stop it...${NC}"
    if command -v brew &> /dev/null && brew services list | grep -q "postgresql.*started"; then
        brew services stop postgresql 2>/dev/null || true
        echo -e "${GREEN}  Stopped local PostgreSQL via brew${NC}"
    elif command -v pg_ctl &> /dev/null; then
        pg_ctl -D /usr/local/var/postgres stop 2>/dev/null || \
        pg_ctl -D ~/Library/Application\ Support/Postgres/var-* stop 2>/dev/null || true
        echo -e "${GREEN}  Stopped local PostgreSQL via pg_ctl${NC}"
    else
        echo -e "${YELLOW}  Could not stop automatically. Please stop it manually.${NC}"
    fi
    sleep 2
else
    echo -e "${GREEN}  No local PostgreSQL on port 5432${NC}"
fi

# =============================================================================
# 2. Detect container runtime
# =============================================================================
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
        echo -e "${YELLOW}  Docker installed but not running. Trying Podman...${NC}"
        CONTAINER_RUNTIME=""
    else
        echo -e "${GREEN}  Using Docker${NC}"
    fi
fi

if [ -z "$CONTAINER_RUNTIME" ] && command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"
    if command -v podman-compose &> /dev/null; then
        COMPOSE_CMD="podman-compose"
    else
        COMPOSE_CMD="podman compose"
    fi
    if ! podman machine list 2>/dev/null | grep -qi "running"; then
        echo -e "${YELLOW}  Starting Podman machine...${NC}"
        podman machine start 2>/dev/null || {
            podman machine init 2>/dev/null && podman machine start
        } || true
    fi
    echo -e "${GREEN}  Using Podman${NC}"
fi

if [ -z "$CONTAINER_RUNTIME" ]; then
    echo -e "${RED}  No container runtime available.${NC}"
    exit 1
fi

# Both runtimes publish to the same host ports. Whichever bound them first wins, and the
# loser's containers still report their mappings while being unreachable from the host —
# so health checks hang and Prisma fails with P1001 against a container that looks healthy.
if [ "$CONTAINER_RUNTIME" = "docker" ] && command -v podman &> /dev/null; then
    if podman ps --format '{{.Names}}' 2>/dev/null | grep -q .; then
        echo -e "${RED}❌ Podman containers are running while Docker is the selected runtime.${NC}"
        echo -e "${YELLOW}   They hold the dev ports (5433, 4443, 6379, ...), so the Docker${NC}"
        echo -e "${YELLOW}   containers this script starts will be unreachable from the host.${NC}"
        echo -e "${YELLOW}   Stop them first:  ${BLUE}podman machine stop${NC}"
        exit 1
    fi
fi

# =============================================================================
# 3. Interactive feature selection (arrow keys + space to toggle, enter to confirm)
# =============================================================================
FEATURE_LABELS=(
    "Chat & Tickets    (always on — postgres, redis, zero-cache, fake-gcs, minio)"
    "Xyne-Claw         (AI agent — uses consolidated postgres, no extra container)"
    "Canvas            (y-sweet collaborative editing — inside dev-infra)"
    "Calls             (livekit inside dev-infra — no extra container)"
    "Transcription     (audio transcription — 1 container, shared with recording if both)"
    "Call Recording    (livekit egress — 1 container, shared with transcription if both)"
    "Search            (vespa full-text search — 1 extra container)"
    "Observability     (otel + victoriametrics + grafana — inside dev-infra)"
    "Feature Flags     (superposition — inside dev-infra)"
)
NUM_FEATURES=${#FEATURE_LABELS[@]}
CURSOR=1                          # start on Xyne-Claw (first toggleable item)
declare -a CHECKED=(1 0 0 0 0 0 0 0 0)  # index 0 = Chat & Tickets, always on

render_menu() {
    echo ""
    echo -e "${BOLD}Which features do you need?${NC} ${YELLOW}(▲/▼ move, space toggle, enter confirm)${NC}"
    echo ""
    for i in $(seq 0 $((NUM_FEATURES - 1))); do
        if [ "$i" -eq 0 ]; then
            box="${GREEN}[x]${NC}"
        elif [ "${CHECKED[$i]}" = "1" ]; then
            box="${GREEN}[x]${NC}"
        else
            box="[ ]"
        fi
        if [ "$i" -eq "$CURSOR" ]; then
            echo -e "  ${CYAN}> ${box} ${FEATURE_LABELS[$i]}${NC}"
        elif [ "$i" -eq 0 ]; then
            echo -e "    ${box} ${CYAN}${FEATURE_LABELS[$i]}${NC}"
        else
            echo -e "    ${box} ${FEATURE_LABELS[$i]}"
        fi
    done
    echo ""
}

MOVE_UP=$((NUM_FEATURES + 3))      # lines printed = 1 blank + 1 title + 1 blank + N options + 1 blank
tput civis 2>/dev/null || true     # hide cursor

render_menu
MOVE_LINES=$((NUM_FEATURES + 4))
while true; do
    IFS= read -rsn1 key
    case "$key" in
        $'\x1b')                    # escape sequence (arrow keys)
            read -rsn2 rest
            case "$rest" in
                '[A')               # up
                    [ "$CURSOR" -gt 1 ] && CURSOR=$((CURSOR - 1)) ;;
                '[B')               # down
                    [ "$CURSOR" -lt $((NUM_FEATURES - 1)) ] && CURSOR=$((CURSOR + 1)) ;;
            esac
            ;;
        ' ')                        # space — toggle (feature 0 is always on)
            if [ "$CURSOR" -gt 0 ]; then
                CHECKED[$CURSOR]=$((1 - CHECKED[$CURSOR]))
            fi
            ;;
        '')                         # enter — confirm
            break
            ;;
    esac
    tput cuu "$MOVE_LINES" 2>/dev/null || printf "\033[%sA" "$MOVE_LINES"
    render_menu
done
tput cnorm 2>/dev/null || true     # restore cursor

# Build SELECTED_FEATURES from checkboxes (feature 1 always on)
SELECTED_FEATURES="1"
for i in $(seq 1 $((NUM_FEATURES - 1))); do
    if [ "${CHECKED[$i]}" = "1" ]; then
        SELECTED_FEATURES="${SELECTED_FEATURES},$((i + 1))"
    fi
done

# Determine env vars and compose profiles
ENABLE_STORAGE=1          # always on (Chat & Tickets needs fake-gcs + minio)
ENABLE_OBSERVABILITY=0
ENABLE_CALLS=0
ENABLE_FEATURE_FLAGS=0
ENABLE_TRANSCRIPTION=0
ENABLE_EGRESS=0
COMPOSE_PROFILES=""

# Feature mapping:
# 1: Chat & Tickets  → always on
# 2: Xyne-Claw       → no extra containers
# 3: Canvas          → y-sweet inside dev-infra (ENABLE_STORAGE)
# 4: Calls           → livekit inside dev-infra (ENABLE_CALLS)
# 5: Transcription   → call-services container (ENABLE_TRANSCRIPTION, profile: transcription)
# 6: Call Recording  → call-services container (ENABLE_EGRESS, profile: egress)
# 7: Search          → vespa container (profile: search)
# 8: Observability   → inside dev-infra (ENABLE_OBSERVABILITY)
# 9: Feature Flags   → inside dev-infra (ENABLE_FEATURE_FLAGS)

if echo "$SELECTED_FEATURES" | grep -qw "4"; then
    ENABLE_CALLS=1
fi
if echo "$SELECTED_FEATURES" | grep -qw "5"; then
    ENABLE_TRANSCRIPTION=1
    COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}transcription"
fi
if echo "$SELECTED_FEATURES" | grep -qw "6"; then
    ENABLE_EGRESS=1
    COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}egress"
fi
if echo "$SELECTED_FEATURES" | grep -qw "7"; then
    COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}search"
fi
if echo "$SELECTED_FEATURES" | grep -qw "8"; then
    ENABLE_OBSERVABILITY=1
fi
if echo "$SELECTED_FEATURES" | grep -qw "9"; then
    ENABLE_FEATURE_FLAGS=1
fi

# Build summary
SELECTED_NAMES=""
for f in $(echo "$SELECTED_FEATURES" | tr ',' ' '); do
    case "$f" in
        1) SELECTED_NAMES="${SELECTED_NAMES}Chat+Tickets " ;;
        2) SELECTED_NAMES="${SELECTED_NAMES}Xyne-Claw " ;;
        3) SELECTED_NAMES="${SELECTED_NAMES}Canvas " ;;
        4) SELECTED_NAMES="${SELECTED_NAMES}Calls " ;;
        5) SELECTED_NAMES="${SELECTED_NAMES}Search " ;;
        6) SELECTED_NAMES="${SELECTED_NAMES}Observability " ;;
        7) SELECTED_NAMES="${SELECTED_NAMES}Feature-Flags " ;;
    esac
done
echo ""
echo -e "${GREEN}Selected:${NC} ${SELECTED_NAMES}"
echo ""

# Export for docker compose
export ENABLE_STORAGE
export ENABLE_OBSERVABILITY
export ENABLE_CALLS
export ENABLE_FEATURE_FLAGS
export ENABLE_TRANSCRIPTION
export ENABLE_EGRESS
export COMPOSE_PROFILES

# =============================================================================
# 4. Build dev-infra image (if needed)
# =============================================================================
echo -e "${BLUE}Building dev-infra image (first time may take a few minutes)...${NC}"
$COMPOSE_CMD -f "$COMPOSE_FILE" build dev-infra

# =============================================================================
# 5. Start containers
# =============================================================================
echo -e "${BLUE}Starting containers...${NC}"

# Always start dev-infra (core + storage if enabled)
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d dev-infra

# Start profile-specific containers
if [ -n "$COMPOSE_PROFILES" ]; then
    echo -e "${BLUE}Starting feature containers (profiles: $COMPOSE_PROFILES)...${NC}"
    $COMPOSE_CMD -f "$COMPOSE_FILE" --profile $(echo "$COMPOSE_PROFILES" | tr ',' ' ' | sed 's/ / --profile /g') up -d
fi

# =============================================================================
# 6. Wait for PostgreSQL (single instance — all databases)
# =============================================================================
echo -e "${BLUE}Waiting for PostgreSQL...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T dev-infra pg_isready -U xyne -d xyne_dev_db > /dev/null 2>&1; then
        echo -e "${GREEN}  PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}  PostgreSQL failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# =============================================================================
# 7. Wait for Redis
# =============================================================================
echo -e "${BLUE}Waiting for Redis...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T dev-infra redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}  Redis is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}  Redis failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# =============================================================================
# 8. Wait for fake-gcs (if storage enabled) and create buckets
# =============================================================================
if [ "$ENABLE_STORAGE" = "1" ]; then
    echo -e "${BLUE}Waiting for fake-gcs-server...${NC}"
    for i in {1..30}; do
        if curl -s $CURL_TIMEOUT http://localhost:4443/storage/v1/b > /dev/null 2>&1; then
            echo -e "${GREEN}  fake-gcs-server is ready${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${YELLOW}  fake-gcs-server not ready (continuing)${NC}"
            break
        fi
        sleep 1
    done

    # Create buckets
    if curl -s $CURL_TIMEOUT http://localhost:4443/storage/v1/b > /dev/null 2>&1; then
        echo -e "${BLUE}Creating fake-gcs buckets...${NC}"
        curl -s $CURL_TIMEOUT -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
          -H "Content-Type: application/json" -d '{"name":"xyne-frontend-bundles"}' > /dev/null 2>&1
        curl -s $CURL_TIMEOUT -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
          -H "Content-Type: application/json" -d '{"name":"xyne-spaces-chat-documents"}' > /dev/null 2>&1
        curl -s $CURL_TIMEOUT -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
          -H "Content-Type: application/json" -d '{"name":"transcription-dev-v2"}' > /dev/null 2>&1
        curl -s $CURL_TIMEOUT -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
          -H "Content-Type: application/json" -d '{"name":"xyne-spaces-canvas-documents"}' > /dev/null 2>&1
        echo -e "${GREEN}  fake-gcs buckets created${NC}"
    fi

    # Wait for MinIO
    echo -e "${BLUE}Waiting for MinIO...${NC}"
    for i in {1..30}; do
        if curl -s $CURL_TIMEOUT http://localhost:9000/minio/health/live > /dev/null 2>&1; then
            echo -e "${GREEN}  MinIO is ready${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${YELLOW}  MinIO not ready (optional, continuing)${NC}"
            break
        fi
        sleep 1
    done
fi

# =============================================================================
# 9. Database migrations
# =============================================================================
echo -e "${BLUE}Setting up database schema...${NC}"
cd "$REPO_ROOT/apps/backend"

# Create .env.local from .env.example if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}  apps/backend/.env.local not found. Creating from .env.example...${NC}"
    cp .env.example .env.local
    echo -e "${YELLOW}  Please review and update values as needed.${NC}"
fi

# Always run, not just on first creation: an .env.local that predates this script (or one
# whose creation run died partway) keeps its `set-me` placeholders, and the backend then
# fails at startup with "JWT_SECRET ... must be at least 32 characters". The generator only
# replaces placeholder/empty values, so re-running it never clobbers a real secret.
node "$REPO_ROOT/scripts/generate-local-secrets.mjs"

# Migrate COMMON_DATABASE_URL port from 5434 → 5433 (consolidated postgres)
if grep -q "localhost:5434" .env.local 2>/dev/null; then
    echo -e "${YELLOW}  Migrating COMMON_DATABASE_URL from port 5434 to 5433 (consolidated postgres)...${NC}"
    sed -i.bak 's/localhost:5434/localhost:5433/g' .env.local
    rm -f .env.local.bak
fi

# Export DB URLs from .env.local
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
echo -e "${BLUE}  DATABASE_URL: ${DATABASE_URL}${NC}"

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Backend dependencies not installed. Skipping DB setup.${NC}"
    echo -e "${YELLOW}  Run: cd apps/backend && pnpm install && pnpm run services${NC}"
    cd "$REPO_ROOT"
else
    # Check if users table exists (Prisma creates lowercase table names)
    USER_COUNT=$($COMPOSE_CMD -f ../"$COMPOSE_FILE" exec -T dev-infra psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || true)
    USER_COUNT=$(echo "$USER_COUNT" | xargs)

    if [ -z "$USER_COUNT" ] || [[ "$USER_COUNT" == *"ERROR"* ]] || [[ "$USER_COUNT" == *"does not exist"* ]]; then
        # First run
        echo -e "${YELLOW}  User table doesn't exist. Setting up database from scratch...${NC}"

        # Stop zero-cache and clear its cache
        echo -e "${BLUE}  Stopping zero-cache and clearing cache...${NC}"
        $COMPOSE_CMD -f ../"$COMPOSE_FILE" exec -T dev-infra supervisorctl stop zero-cache 2>/dev/null || true
        docker volume rm xyne-spaces_zero_cache_data 2>/dev/null || podman volume rm xyne-spaces_zero_cache_data 2>/dev/null || true

        # Drop and recreate database
        echo -e "${BLUE}  Dropping and recreating database...${NC}"
        $COMPOSE_CMD -f ../"$COMPOSE_FILE" exec -T dev-infra psql -U xyne -d postgres -c "DROP DATABASE IF EXISTS xyne_dev_db;" 2>/dev/null
        $COMPOSE_CMD -f ../"$COMPOSE_FILE" exec -T dev-infra psql -U xyne -d postgres -c "CREATE DATABASE xyne_dev_db OWNER xyne;" 2>/dev/null

        # Push schema with force-reset (first time setup - ensures tables are created)
        echo -e "${BLUE}  Creating database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --force-reset --accept-data-loss --skip-generate

        # Push common database schema (same postgres, different DB)
        echo -e "${BLUE}  Creating common database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma --force-reset --accept-data-loss --skip-generate

        # Generate Prisma clients
        echo -e "${BLUE}  Generating Prisma client...${NC}"
        pnpm exec prisma generate
        pnpm exec prisma generate --schema prisma-common/schema.prisma
        echo -e "${GREEN}  Prisma client generated${NC}"

        # Seed ACL system
        echo -e "${BLUE}  Seeding ACL system...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
        echo -e "${GREEN}  ACL system seeded${NC}"

        # Create developer user (uses DEFAULT_ADMIN_EMAIL from .env.local)
        echo -e "${BLUE}  Creating developer user...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-user-group.ts
        echo -e "${GREEN}  Developer user created${NC}"
    else
        # Existing DB — sync schema without dropping data
        echo -e "${BLUE}  Syncing database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push

        echo -e "${BLUE}  Syncing common database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma --accept-data-loss --skip-generate
        pnpm exec prisma generate --schema prisma-common/schema.prisma
        echo -e "${GREEN}  Database schema is up to date${NC}"

        # Check for default workspace
        WORKSPACE_EXISTS=$($COMPOSE_CMD -f ../"$COMPOSE_FILE" exec -T dev-infra psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
        if [ "$WORKSPACE_EXISTS" = "0" ] || [ -z "$WORKSPACE_EXISTS" ]; then
            echo -e "${YELLOW}  Default workspace not found. Running seed...${NC}"
            pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
            echo -e "${GREEN}  ACL system seeded${NC}"
        else
            echo -e "${GREEN}  Default workspace exists${NC}"
        fi
    fi

    echo -e "${GREEN}  Database ready${NC}"
    cd "$REPO_ROOT"
fi

# Start zero-cache
echo -e "${BLUE}🚀 Starting zero-cache...${NC}"
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d zero-cache

# Wait for zero-cache
echo -e "${BLUE}⏳ Waiting for Zero cache...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" logs zero-cache 2>&1 | grep -q "zero-cache ready"; then
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
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d claw-auth-postgres

echo -e "${BLUE}⏳ Waiting for claw-auth-postgres...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T claw-auth-postgres pg_isready -U claw -d claw_auth_db > /dev/null 2>&1; then
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
    cd "$REPO_ROOT/packages/kata-sdk"
    echo -e "${YELLOW}⚠️  kata-sdk dependencies not installed. Running pnpm install...${NC}"
    pnpm install
    echo -e "${GREEN}✓ kata-sdk ready${NC}"
    cd "$REPO_ROOT"
fi

# Setup xyne-claw-shared (shared dependency for xyne-claw and xyne-claw-auth)
echo -e "${BLUE}🔧 Setting up xyne-claw-shared...${NC}"
if [ -d "packages/xyne-claw-shared" ] && [ ! -d "packages/xyne-claw-shared/node_modules" ]; then
    cd "$REPO_ROOT/packages/xyne-claw-shared"
    echo -e "${YELLOW}⚠️  xyne-claw-shared dependencies not installed. Running pnpm install...${NC}"
    pnpm install
    echo -e "${GREEN}✓ xyne-claw-shared ready${NC}"
    cd "$REPO_ROOT"
fi

# Setup xyne-claw-auth backend
echo -e "${BLUE}🔧 Setting up xyne-claw-auth backend...${NC}"
if [ ! -f "apps/xyne-claw-auth/backend/.env" ]; then
    echo -e "${YELLOW}⚠️  apps/xyne-claw-auth/backend/.env not found. Creating from .env.example...${NC}"
    cp apps/xyne-claw-auth/backend/.env.example apps/xyne-claw-auth/backend/.env
    echo -e "${GREEN}✓ Created apps/xyne-claw-auth/backend/.env${NC}"
    echo -e "${YELLOW}   Please review and update values as needed.${NC}"
fi

# =============================================================================
# 10. Restart zero-cache (after DB migrations)
# =============================================================================
echo -e "${BLUE}Restarting zero-cache...${NC}"
$COMPOSE_CMD -f "$COMPOSE_FILE" exec -T dev-infra supervisorctl restart zero-cache 2>/dev/null || true

echo -e "${BLUE}Waiting for zero-cache...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" logs dev-infra 2>&1 | grep -q "zero-cache ready"; then
        echo -e "${GREEN}  Zero cache is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}  Zero cache taking longer than expected, continuing...${NC}"
        break
    fi
    sleep 1
done

# =============================================================================
# 11. Setup xyne-claw-auth (if Xyne-Claw feature selected)
# =============================================================================
echo -e "${BLUE}Setting up xyne-claw-auth...${NC}"

# Migrate claw-auth DATABASE_URL from port 5435 → 5433 (consolidated postgres)
if [ -f "apps/xyne-claw-auth/backend/.env" ] && grep -q "localhost:5435" apps/xyne-claw-auth/backend/.env 2>/dev/null; then
    echo -e "${YELLOW}  Migrating claw-auth DATABASE_URL from port 5435 to 5433...${NC}"
    sed -i.bak 's/localhost:5435/localhost:5433/g' apps/xyne-claw-auth/backend/.env
    rm -f apps/xyne-claw-auth/backend/.env.bak
fi

if [ ! -f "apps/xyne-claw-auth/backend/.env" ]; then
    echo -e "${YELLOW}  apps/xyne-claw-auth/backend/.env not found. Creating from .env.example...${NC}"
    cp apps/xyne-claw-auth/backend/.env.example apps/xyne-claw-auth/backend/.env
    # Fix port for consolidated postgres
    sed -i.bak 's/localhost:5435/localhost:5433/g' apps/xyne-claw-auth/backend/.env
    rm -f apps/xyne-claw-auth/backend/.env.bak
    echo -e "${GREEN}  Created apps/xyne-claw-auth/backend/.env${NC}"
fi

# Ensure SPACES_DB_URL is set (links claw-auth to Spaces DB for JIT user mirroring)
if ! grep -q "^SPACES_DB_URL=" apps/xyne-claw-auth/backend/.env 2>/dev/null; then
    echo 'SPACES_DB_URL=postgresql://xyne:xyne123@localhost:5433/xyne_dev_db' >> apps/xyne-claw-auth/backend/.env
    echo -e "${GREEN}  Added SPACES_DB_URL to apps/xyne-claw-auth/backend/.env${NC}"
fi

if [ -f "apps/xyne-claw-auth/backend/.env" ]; then
    echo -e "${BLUE}  Setting up xyne-claw-auth database schema...${NC}"
    cd "$REPO_ROOT/apps/xyne-claw-auth/backend"
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}  Installing apps/xyne-claw-auth/backend dependencies...${NC}"
        pnpm install
    fi
    set -a && source .env && set +a
    if [ -z "$DEFAULT_ADMIN_EMAIL" ]; then
      export DEFAULT_ADMIN_EMAIL=$(grep -m 1 '^DEFAULT_ADMIN_EMAIL=' "$REPO_ROOT/apps/backend/.env.local" 2>/dev/null | sed 's/^DEFAULT_ADMIN_EMAIL=//' || echo "admin@example.in")
    fi
    pnpm exec prisma db push --skip-generate --accept-data-loss
    pnpm exec prisma generate
    NODE_OPTIONS="" pnpm exec tsx prisma/seed.ts
    echo -e "${GREEN}✓ xyne-claw-auth database schema ready${NC}"
    cd "$REPO_ROOT"
fi

# Setup xyne-claw-auth frontend
echo -e "${BLUE}🔧 Setting up xyne-claw-auth frontend...${NC}"
if [ -d "apps/xyne-claw-auth/frontend" ]; then
    cd "$REPO_ROOT/apps/xyne-claw-auth/frontend"
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  apps/xyne-claw-auth/frontend dependencies not installed. Running pnpm install...${NC}"
        pnpm install
    fi
    echo -e "${GREEN}✓ xyne-claw-auth frontend ready${NC}"
    cd "$REPO_ROOT"
fi

# Setup xyne-claw
echo -e "${BLUE}🔧 Setting up xyne-claw...${NC}"
if [ ! -f "apps/xyne-claw/.env" ]; then
    echo -e "${YELLOW}⚠️  apps/xyne-claw/.env not found. Creating from .env.example...${NC}"
    cp apps/xyne-claw/.env.example apps/xyne-claw/.env
    echo -e "${GREEN}✓ Created apps/xyne-claw/.env${NC}"
    echo -e "${YELLOW}   Please review and update values as needed.${NC}"
fi

if [ -d "apps/xyne-claw" ]; then
    cd "$REPO_ROOT/apps/xyne-claw"
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  xyne-claw dependencies not installed. Running pnpm install...${NC}"
        pnpm install
    fi
    echo -e "${GREEN}✓ xyne-claw ready${NC}"
    cd "$REPO_ROOT"
fi

# =============================================================================
# 13. Deploy Vespa schemas (if Search feature selected)
# =============================================================================
if echo "$SELECTED_FEATURES" | grep -qw "7"; then
    echo -e "${BLUE}🔎 Deploying Vespa schemas (first run downloads the embedding model)...${NC}"
    if DOCKER_COMPOSE="$COMPOSE_CMD" CONTAINER_CLI="$CONTAINER_RUNTIME" "$REPO_ROOT/vespa-core/scripts/deploy-dev.sh"; then
        echo -e "${GREEN}✓ Vespa schemas deployed${NC}"
    else
        echo -e "${YELLOW}⚠️  Vespa schema deploy failed — search will not work.${NC}"
        echo -e "${YELLOW}   Needs curl plus either zip or python3 (all usually present).${NC}"
        echo -e "${YELLOW}   Retry on its own with: ${BLUE}pnpm run services:vespa${NC}"
    fi
fi

# =============================================================================
# 14. Summary
# =============================================================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Infrastructure Services Running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Consolidated dev-infra container:${NC}"
echo -e "  PostgreSQL (3 DBs):  ${GREEN}localhost:5433${NC}"
echo -e "    - xyne_dev_db"
echo -e "    - xyne_common"
echo -e "    - claw_auth_db"
echo -e "  Redis:               ${GREEN}localhost:6379${NC}"
echo -e "  Zero-cache:          ${GREEN}localhost:4848${NC}"
if [ "$ENABLE_STORAGE" = "1" ]; then
    echo -e "  Fake GCS:            ${GREEN}localhost:4443${NC}"
    echo -e "  MinIO:               ${GREEN}localhost:9000${NC} (console: ${GREEN}localhost:9001${NC})"
    echo -e "  Y-Sweet:             ${GREEN}localhost:8080${NC}"
fi
if [ "$ENABLE_OBSERVABILITY" = "1" ]; then
    echo -e "  OTEL:                ${GREEN}localhost:4318${NC}"
    echo -e "  VictoriaMetrics:     ${GREEN}localhost:8428${NC}"
    echo -e "  Grafana:             ${GREEN}localhost:3333${NC}"
fi
if [ "$ENABLE_CALLS" = "1" ]; then
    echo -e "  LiveKit:             ${GREEN}localhost:7880${NC}"
fi
if [ "$ENABLE_TRANSCRIPTION" = "1" ]; then
    echo -e "  Transcription:       ${GREEN}localhost:8001${NC} (in call-services container)"
fi
if [ "$ENABLE_EGRESS" = "1" ]; then
    echo -e "  Call Recording:      ${GREEN}in call-services container${NC}"
fi
if echo "$SELECTED_FEATURES" | grep -qw "7"; then
    echo -e "  Vespa feed:          ${GREEN}localhost:8083${NC} (separate container)"
    echo -e "  Vespa query:         ${GREEN}localhost:8081${NC}"
fi
if [ "$ENABLE_FEATURE_FLAGS" = "1" ]; then
    echo -e "  Superposition:       ${GREEN}localhost:9999${NC}"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  Backend:        ${BLUE}cd apps/backend && pnpm run dev${NC}"
echo -e "  Dashboard:      ${BLUE}cd apps/dashboard && pnpm run dev${NC}"
if echo "$SELECTED_FEATURES" | grep -qw "2"; then
    echo -e "  XyneClaw:       ${BLUE}cd apps/xyne-claw && pnpm run dev${NC}"
    echo -e "  Claw auth:      ${BLUE}cd apps/xyne-claw-auth/backend && pnpm run dev${NC}"
    echo -e "  Claw auth UI:   ${BLUE}cd apps/xyne-claw-auth/frontend && pnpm run dev${NC}"
fi
echo ""
echo -e "${YELLOW}To stop services:${NC}"
echo -e "  ${BLUE}$COMPOSE_CMD -f $COMPOSE_FILE down${NC}"
echo ""

# Read dev user email from .env.local for credentials display
DEV_EMAIL=$(grep -m 1 '^DEFAULT_ADMIN_EMAIL=' apps/backend/.env.local 2>/dev/null | sed 's/^DEFAULT_ADMIN_EMAIL=//' || true)
if [ -z "$DEV_EMAIL" ] || [[ "$DEV_EMAIL" == definition* ]]; then
    DEV_EMAIL="admin@xyne.ai"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Local Dev Login Credentials${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  ${BLUE}Email:${NC}     ${DEV_EMAIL}"
echo -e "  ${BLUE}Password:${NC}  ${GREEN}xynelocal@123${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}💡 Tip: update DEFAULT_ADMIN_EMAIL in apps/backend/.env.local and re-run 'pnpm run services' to use your own email.${NC}"
echo ""
