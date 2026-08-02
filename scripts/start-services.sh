#!/bin/bash

# Xyne Spaces — Local Dev Infrastructure with Interactive Feature Selection
#
# Instead of starting ~16 containers at once, this script asks which features you
# need and starts only those services. Each one is a separate container from its
# own upstream image (docker-compose.dev.yml), so nothing is built from scratch
# beyond three thin local images, and a failure in one service cannot take the
# rest of the environment down with it.
#
# Feature → service mapping:
#   Chat & Tickets  (always on)  → postgres (xyne_dev_db + xyne_common + claw_auth_db),
#                                  redis, zero-cache, fake-gcs, minio
#   Xyne-Claw                    → no extra container (claw_auth_db lives in postgres)
#   Canvas                       → ysweet
#   Calls                        → livekit
#   Transcription                → transcription-agent
#   Call Recording               → livekit-egress (pulls in livekit)
#   Search                       → vespa (its own compose file)
#   Observability                → otel-collector, victoriametrics, grafana
#   Feature Flags                → superposition

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

COMPOSE_FILE="docker-compose.dev.yml"

# Ask whether the developer wants a login of their own in addition to the seeded
# default. Sets DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD when they do and leaves both
# empty when they don't — the default admin account is created either way.
#
# Skipped when stdin is not a terminal, so CI and scripted runs are unaffected.
prompt_dev_login() {
    DEV_LOGIN_EMAIL=""
    DEV_LOGIN_PASSWORD=""

    local default_email
    default_email=$(grep -m 1 '^DEFAULT_ADMIN_EMAIL=' "$REPO_ROOT/apps/backend/.env.local" 2>/dev/null | sed 's/^DEFAULT_ADMIN_EMAIL=//' || true)
    [ -z "$default_email" ] && default_email="admin@xyne.ai"

    if [ ! -t 0 ] || [ "${SKIP_LOGIN_PROMPT:-0}" = "1" ]; then
        return 0
    fi

    echo ""
    echo -e "${BOLD}${BLUE}Local login${NC}"
    echo -e "   ${default_email} / xynelocal@123 is always created for you."
    printf "   Add your own login as well? [y/N] "
    read -r want_own || true

    case "$want_own" in
        [Yy]*)
            while [ -z "$DEV_LOGIN_EMAIL" ]; do
                printf "   Email: "
                read -r DEV_LOGIN_EMAIL || true
            done
            while [ "${#DEV_LOGIN_PASSWORD}" -lt 8 ]; do
                printf "   Password (at least 8 characters): "
                read -rs DEV_LOGIN_PASSWORD || true
                echo ""
            done
            ;;
        *)
            echo ""
            echo -e "   ${BLUE}Email:${NC}    ${GREEN}${default_email}${NC}"
            echo -e "   ${BLUE}Password:${NC} ${GREEN}xynelocal@123${NC}"
            echo ""
            printf "   Copy these somewhere safe, then press Enter to continue... "
            read -r _ || true
            ;;
    esac
}

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
    "Xyne-Claw         (AI agents — no extra container)"
    "Canvas            (y-sweet collaborative editing)"
    "Calls             (livekit)"
    "Transcription     (transcription-agent)"
    "Call Recording    (livekit-egress)"
    "Search            (vespa full-text search)"
    "Observability     (otel-collector, victoriametrics, grafana)"
    "Feature Flags     (superposition)"
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

# Restore the cursor no matter how we leave the picker. Without this a Ctrl-C
# during selection exits with the cursor still hidden, and every later prompt in
# that terminal is invisible until the user runs `tput cnorm` themselves.
restore_cursor() { tput cnorm 2>/dev/null || true; }
trap 'restore_cursor; exit 130' INT TERM
trap restore_cursor EXIT

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
# Each feature maps to the compose services it needs. Every service is its own
# container from its own upstream image, so an unselected feature costs nothing
# and one flaky download cannot take the whole environment with it.
#
# Vespa is deliberately absent here — it lives in its own compose file and is
# started separately below.
SERVICES="postgres redis zero-cache fake-gcs minio"   # 1: always on

if echo "$SELECTED_FEATURES" | grep -qw "2"; then
    :  # claw_auth_db is a logical database inside the shared postgres — no extra container
fi
if echo "$SELECTED_FEATURES" | grep -qw "3"; then
    SERVICES="$SERVICES ysweet"
fi
if echo "$SELECTED_FEATURES" | grep -qw "4"; then
    ENABLE_CALLS=1
    SERVICES="$SERVICES livekit"
fi
if echo "$SELECTED_FEATURES" | grep -qw "5"; then
    ENABLE_TRANSCRIPTION=1
    # transcription-agent-cache is a named volume, not a service — compose
    # creates it automatically when transcription-agent starts.
    SERVICES="$SERVICES transcription-agent"
fi
if echo "$SELECTED_FEATURES" | grep -qw "6"; then
    ENABLE_EGRESS=1
    # Egress records what LiveKit is serving, so it is useless without it.
    echo "$SERVICES" | grep -qw livekit || SERVICES="$SERVICES livekit"
    SERVICES="$SERVICES livekit-egress"
fi
if echo "$SELECTED_FEATURES" | grep -qw "7"; then
    START_VESPA=1
fi
if echo "$SELECTED_FEATURES" | grep -qw "8"; then
    ENABLE_OBSERVABILITY=1
    SERVICES="$SERVICES otel-collector victoriametrics grafana"
fi
if echo "$SELECTED_FEATURES" | grep -qw "9"; then
    ENABLE_FEATURE_FLAGS=1
    SERVICES="$SERVICES superposition"
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
# 4. Start the selected containers
# =============================================================================
# Compose pulls upstream images and builds only the three thin local ones
# (postgres, livekit, transcription-agent) — and only when they are selected.
# --build is deliberate: without it compose reuses whatever image already carries
# the tag, so a postgres image built from an older docker/init-db.sh keeps
# initialising new volumes with the old script. The three images are a COPY on
# top of an upstream base, so a no-op rebuild is nearly free.
echo -e "${BLUE}Starting containers...${NC}"
echo -e "${CYAN}  $(echo "$SERVICES" | wc -w | tr -d ' ') services: ${SERVICES}${NC}"
# shellcheck disable=SC2086 — SERVICES is a deliberately word-split list
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d --build $SERVICES

# Vespa ships its own compose file with its own volume. -p pins it to the same
# project as everything else; without it compose would name the project after the
# file's parent directory ("deployment") and split Vespa off from the stack.
if [ "${START_VESPA:-0}" = "1" ]; then
    VESPA_COMPOSE="$REPO_ROOT/vespa-core/deployment/docker-compose.dev.yml"
    VESPA_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$REPO_ROOT")}"
    if [ -f "$VESPA_COMPOSE" ]; then
        echo -e "${BLUE}Starting Vespa...${NC}"
        if $COMPOSE_CMD -p "$VESPA_PROJECT" -f "$VESPA_COMPOSE" up -d; then
            echo -e "${GREEN}  Vespa started${NC}"
        else
            echo -e "${YELLOW}  Vespa failed to start — continuing without search${NC}"
            START_VESPA=0
        fi
    else
        echo -e "${YELLOW}  $VESPA_COMPOSE not found — skipping Vespa${NC}"
        START_VESPA=0
    fi
fi

# =============================================================================
# 6. Wait for PostgreSQL (single instance — all databases)
# =============================================================================
echo -e "${BLUE}Waiting for PostgreSQL...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres pg_isready -U xyne -d xyne_dev_db > /dev/null 2>&1; then
        echo -e "${GREEN}  PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}  PostgreSQL failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# The claw role, claw_auth_db and xyne_common come from docker/init-db.sh, which
# only runs when the container initialises an *empty* data directory — and only
# with the copy of the script baked into the image at build time. A volume older
# than those additions, or a stale locally-built postgres image, leaves the
# cluster without them and claw-auth then dies with "P1000: Authentication failed
# ... for `claw`". Creating them here is idempotent: it is a no-op whenever
# init-db.sh already did the work.
CLAW_DB_USER="${CLAW_DB_USER:-claw}"
CLAW_DB_PASSWORD="${CLAW_DB_PASSWORD:-claw123}"

psql_postgres() {
    $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres \
        psql -v ON_ERROR_STOP=1 --username xyne --dbname postgres "$@"
}

ensure_database() {
    local db_name="$1" db_owner="$2"
    if ! psql_postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" 2>/dev/null | grep -q 1; then
        echo -e "${YELLOW}  Creating missing database ${db_name}...${NC}"
        psql_postgres -c "CREATE DATABASE ${db_name} OWNER ${db_owner};" > /dev/null
    fi
}

if ! psql_postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${CLAW_DB_USER}'" 2>/dev/null | grep -q 1; then
    echo -e "${YELLOW}  Creating missing role ${CLAW_DB_USER}...${NC}"
    psql_postgres -c "CREATE ROLE ${CLAW_DB_USER} LOGIN PASSWORD '${CLAW_DB_PASSWORD}';" > /dev/null
fi

ensure_database "xyne_common" "xyne"
ensure_database "claw_auth_db" "$CLAW_DB_USER"

# The backend's common schema lives in a named schema, not public — see
# COMMON_DATABASE_URL's ?schema=common.
$COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres \
    psql -v ON_ERROR_STOP=1 --username xyne --dbname xyne_common \
    -c "CREATE SCHEMA IF NOT EXISTS common AUTHORIZATION xyne;" > /dev/null

# =============================================================================
# 7. Wait for Redis
# =============================================================================
echo -e "${BLUE}Waiting for Redis...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T redis redis-cli ping > /dev/null 2>&1; then
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
        # claw-auth's bucket (GCS_BUCKET_NAME): agent attachments *and* the
        # claw-sessions/ archive xyne-claw restores a chat from. xyne-claw
        # refuses to start a run when it cannot verify that archive, so this
        # bucket must exist.
        curl -s $CURL_TIMEOUT -X POST "http://localhost:4443/storage/v1/b?project=xyne-spaces" \
          -H "Content-Type: application/json" -d '{"name":"xyne-claw-chat-attachments"}' > /dev/null 2>&1
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
    # Check if users table exists (Prisma creates lowercase table names).
    #
    # This decides whether to DROP the database, so an answer we cannot interpret
    # must stop rather than guess. A numeric reply means the schema is there; a
    # "does not exist" error means a genuine first run; anything else (connection
    # refused, auth failure, the container still starting) is ambiguous, and
    # treating it as a first run would destroy a working database.
    USER_COUNT=$($COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" exec -T postgres psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || true)
    USER_COUNT=$(echo "$USER_COUNT" | xargs)

    if ! printf '%s' "$USER_COUNT" | grep -qE '^[0-9]+$' \
       && ! printf '%s' "$USER_COUNT" | grep -qi "does not exist"; then
        echo -e "${RED}  Could not query the database to decide how to set it up.${NC}"
        echo -e "${RED}  psql said: ${USER_COUNT}${NC}"
        echo -e "${YELLOW}  Refusing to continue — proceeding would drop and recreate xyne_dev_db.${NC}"
        echo -e "${YELLOW}  Check the postgres container:  ${BLUE}$COMPOSE_CMD -f $COMPOSE_FILE logs postgres${NC}"
        exit 1
    fi

    if printf '%s' "$USER_COUNT" | grep -qi "does not exist"; then
        # First run
        echo -e "${YELLOW}  User table doesn't exist. Setting up database from scratch...${NC}"

        # Stop zero-cache and clear its cache
        echo -e "${BLUE}  Stopping zero-cache and clearing cache...${NC}"
        $COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" stop zero-cache 2>/dev/null || true
        docker volume rm xyne-spaces_zero_cache_data 2>/dev/null || podman volume rm xyne-spaces_zero_cache_data 2>/dev/null || true

        # Drop and recreate database
        echo -e "${BLUE}  Dropping and recreating database...${NC}"
        $COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" exec -T postgres psql -U xyne -d postgres -c "DROP DATABASE IF EXISTS xyne_dev_db;" 2>/dev/null
        $COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" exec -T postgres psql -U xyne -d postgres -c "CREATE DATABASE xyne_dev_db OWNER xyne;" 2>/dev/null

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

        # Kept from f349ea7a7 (XYNE-54948): a fresh database needs the app permission
        # registry seeded too, otherwise app-scoped permission checks find nothing.
        echo -e "${BLUE}  Seeding app permission registry...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-app-permissions.ts
        echo -e "${GREEN}  App permissions seeded${NC}"
    else
        # Existing DB — sync schema without dropping data
        echo -e "${BLUE}  Syncing database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push

        echo -e "${BLUE}  Syncing common database schema...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma --accept-data-loss --skip-generate
        pnpm exec prisma generate --schema prisma-common/schema.prisma
        echo -e "${GREEN}  Database schema is up to date${NC}"

        # Check for default workspace.
        #
        # Only a bare integer means the query actually answered. Any other output —
        # "ERROR: relation ... does not exist", a connection failure, a psql notice —
        # means we cannot conclude anything, and the old check treated all of those
        # as "it exists" and skipped seeding. That is how you end up with a database
        # that has no workspace and a run that claims everything is fine.
        # Seeding is idempotent, so when in doubt, seed.
        WORKSPACE_EXISTS=$($COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" exec -T postgres psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
        if printf '%s' "$WORKSPACE_EXISTS" | grep -qE '^[0-9]+$' && [ "$WORKSPACE_EXISTS" != "0" ]; then
            echo -e "${GREEN}  Default workspace exists${NC}"
        else
            if ! printf '%s' "$WORKSPACE_EXISTS" | grep -qE '^[0-9]+$'; then
                echo -e "${YELLOW}  Could not read the workspace table (${WORKSPACE_EXISTS}). Seeding to be safe...${NC}"
            else
                echo -e "${YELLOW}  Default workspace not found. Running seed...${NC}"
            fi
            pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
            echo -e "${GREEN}  ACL system seeded${NC}"

            # assign-user-group only ran on the from-scratch path, so an existing
            # database that lost its workspace never got the developer user back.
            pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-user-group.ts 2>/dev/null \
                || echo -e "${YELLOW}  Developer user already present${NC}"
        fi
    fi

    # Confirm the seed actually produced a workspace before anything downstream
    # depends on it. Both the login script and the sample-data seed need it, and
    # failing here with one clear message beats two confusing ones later.
    WORKSPACE_CHECK=$($COMPOSE_CMD -f "$REPO_ROOT/$COMPOSE_FILE" exec -T postgres psql -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM workspaces WHERE name = 'Default Workspace';" 2>&1 | xargs)
    if ! printf '%s' "$WORKSPACE_CHECK" | grep -qE '^[1-9][0-9]*$'; then
        echo -e "${RED}  Database setup finished but there is no \"Default Workspace\".${NC}"
        echo -e "${RED}  psql said: ${WORKSPACE_CHECK}${NC}"
        echo -e "${YELLOW}  Seed it by hand and re-run:${NC}"
        echo -e "${YELLOW}    ${BLUE}cd apps/backend && pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts${NC}"
        exit 1
    fi

    echo -e "${GREEN}  Database ready${NC}"

    # Extra login, if the developer asked for one. Additive — seed-acl has already
    # created the default admin and this leaves it alone.
    prompt_dev_login
    if [ -n "${DEV_LOGIN_EMAIL:-}" ]; then
        echo -e "${BLUE}  Adding your login...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/create-dev-login.ts \
            "$DEV_LOGIN_EMAIL" "$DEV_LOGIN_PASSWORD" \
            || echo -e "${YELLOW}  Could not add the extra login — the default admin still works.${NC}"
    fi

    # Sample workspace content: people, channels with real conversations, tickets,
    # a board and a project. Skips itself if it has already run. Non-fatal — an
    # empty workspace is still a working one.
    if [ "${SKIP_DEMO_SEED:-0}" != "1" ]; then
        echo -e "${BLUE}  Seeding sample workspace data...${NC}"
        pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/demo-seed.ts \
            || echo -e "${YELLOW}  Sample data seeding failed — continuing without it.${NC}"
    fi

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

# claw_auth_db is a logical database inside the shared postgres container, created
# by docker/init-db.sh (or by the fallback in section 6 when that script did not
# run) — there is nothing extra to start, only to wait for. The check actually
# opens a session as the claw role: pg_isready only probes the server and reports
# success even when the role or the database is missing.
echo -e "${BLUE}⏳ Waiting for claw_auth_db...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres \
        psql --username "${CLAW_DB_USER:-claw}" --dbname claw_auth_db -tAc "SELECT 1" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ claw_auth_db is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ claw_auth_db is not available${NC}"
        echo -e "${YELLOW}   It is created by docker/init-db.sh, which only runs on a fresh volume.${NC}"
        echo -e "${YELLOW}   If you are upgrading from the three-container setup, reset it with:${NC}"
        echo -e "${YELLOW}     ${BLUE}docker compose -f docker-compose.dev.yml down -v${NC}"
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

# Build litellm-client before starting xyne-claw. Its public exports point to
# dist/, which is intentionally gitignored and must be generated locally.
echo -e "${BLUE}🔧 Setting up litellm-client...${NC}"
pnpm --filter @xyne/litellm-client run build
echo -e "${GREEN}✓ litellm-client ready${NC}"

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
$COMPOSE_CMD -f "$COMPOSE_FILE" restart zero-cache 2>/dev/null || true

echo -e "${BLUE}Waiting for zero-cache...${NC}"
for i in {1..30}; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" logs zero-cache 2>&1 | grep -q "zero-cache ready"; then
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

# Point claw-auth at fake-gcs. Left empty, its GCS client falls back to real GCS
# through Application Default Credentials; a missing or expired ADC token makes
# the session archive endpoints fail with "invalid_grant", and xyne-claw reads
# that as "restore failed" and refuses to open the chat at all rather than fork a
# session that may exist in the archive.
if [ "$ENABLE_STORAGE" = "1" ] && [ -f "apps/xyne-claw-auth/backend/.env" ]; then
    if grep -q "^FAKE_GCS_HOST=[[:space:]]*$" apps/xyne-claw-auth/backend/.env 2>/dev/null; then
        sed -i.bak 's|^FAKE_GCS_HOST=[[:space:]]*$|FAKE_GCS_HOST=localhost:4443|' apps/xyne-claw-auth/backend/.env
        rm -f apps/xyne-claw-auth/backend/.env.bak
        echo -e "${GREEN}  Pointed claw-auth at fake-gcs (FAKE_GCS_HOST=localhost:4443)${NC}"
    elif ! grep -q "^FAKE_GCS_HOST=" apps/xyne-claw-auth/backend/.env 2>/dev/null; then
        echo 'FAKE_GCS_HOST=localhost:4443' >> apps/xyne-claw-auth/backend/.env
        echo -e "${GREEN}  Added FAKE_GCS_HOST to apps/xyne-claw-auth/backend/.env${NC}"
    fi
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
echo -e "${BLUE}Running containers:${NC}"
echo -e "  PostgreSQL:          ${GREEN}localhost:5433${NC}"
echo -e "    - xyne_dev_db      (application)"
echo -e "    - xyne_common      (shared reference data)"
echo -e "    - claw_auth_db     (claw-auth)"
echo -e "  Redis:               ${GREEN}localhost:6379${NC}"
echo -e "  Zero-cache:          ${GREEN}localhost:4848${NC}"
echo -e "  Fake GCS:            ${GREEN}localhost:4443${NC}"
echo -e "  MinIO:               ${GREEN}localhost:9000${NC} (console: ${GREEN}localhost:9001${NC})"
if echo "$SELECTED_FEATURES" | grep -qw "3"; then
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
    echo -e "  Transcription:       ${GREEN}localhost:8001${NC}"
fi
if [ "$ENABLE_EGRESS" = "1" ]; then
    echo -e "  Call Recording:      ${GREEN}livekit-egress${NC}"
fi
if [ "${START_VESPA:-0}" = "1" ]; then
    echo -e "  Vespa feed:          ${GREEN}localhost:8083${NC}"
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
DEV_EMAIL_IS_DEFAULT=false
if [ -z "$DEV_EMAIL" ] || [[ "$DEV_EMAIL" == definition* ]]; then
    DEV_EMAIL="admin@xyne.ai"
    DEV_EMAIL_IS_DEFAULT=true
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Local Dev Login Credentials${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  ${BLUE}Email:${NC}     ${DEV_EMAIL}"
echo -e "  ${BLUE}Password:${NC}  ${GREEN}xynelocal@123${NC}"
echo -e "${GREEN}========================================${NC}"
if [ "$DEV_EMAIL_IS_DEFAULT" = true ]; then
    echo -e "${YELLOW}💡 Tip: update DEFAULT_ADMIN_EMAIL in apps/backend/.env.local and re-run 'pnpm run services' to use your own email.${NC}"
fi
echo ""
