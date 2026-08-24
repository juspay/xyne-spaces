#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOXES_DIR="$PROJECT_ROOT/.sandboxes"

BACKEND_IMAGE_NAME="xyne-sandbox-backend"
DASHBOARD_IMAGE_NAME="xyne-sandbox-dashboard"

compute_deps_hash() {
  # Hash lockfiles + Dockerfiles — any change triggers rebuild
  local hash
  hash=$(cat \
    "$PROJECT_ROOT/backend/package-lock.json" \
    "$PROJECT_ROOT/dashboard/package-lock.json" \
    "$PROJECT_ROOT/shared/package-lock.json" \
    "$PROJECT_ROOT/framework/package-lock.json" \
    "$PROJECT_ROOT/docker/Dockerfile.backend.dev" \
    "$PROJECT_ROOT/docker/Dockerfile.dashboard.dev" \
    2>/dev/null | (md5 -q 2>/dev/null || md5sum | awk '{print $1}'))
  echo "${hash:0:12}"
}

ensure_images() {
  local hash
  hash=$(compute_deps_hash)
  local backend_tag="${BACKEND_IMAGE_NAME}:${hash}"
  local dashboard_tag="${DASHBOARD_IMAGE_NAME}:${hash}"

  local backend_exists dashboard_exists
  backend_exists=$(docker image inspect "$backend_tag" > /dev/null 2>&1 && echo "yes" || echo "no")
  dashboard_exists=$(docker image inspect "$dashboard_tag" > /dev/null 2>&1 && echo "yes" || echo "no")

  if [ "$backend_exists" = "yes" ] && [ "$dashboard_exists" = "yes" ]; then
    echo -e "${GREEN}✓ Using cached images (hash: ${hash})${NC}"
    CURRENT_IMAGE_HASH="$hash"
    return
  fi

  echo -e "${BLUE}🔨 Building base images (deps hash: ${hash})...${NC}"
  if [ "$backend_exists" = "no" ]; then
    echo -e "${BLUE}  Building backend image...${NC}"
    docker build -t "$backend_tag" -t "${BACKEND_IMAGE_NAME}:latest" \
      -f "$PROJECT_ROOT/docker/Dockerfile.backend.dev" "$PROJECT_ROOT"
  fi
  if [ "$dashboard_exists" = "no" ]; then
    echo -e "${BLUE}  Building dashboard image...${NC}"
    docker build -t "$dashboard_tag" -t "${DASHBOARD_IMAGE_NAME}:latest" \
      -f "$PROJECT_ROOT/docker/Dockerfile.dashboard.dev" "$PROJECT_ROOT"
  fi
  echo -e "${GREEN}✓ Base images ready (hash: ${hash})${NC}"
  CURRENT_IMAGE_HASH="$hash"
}

cmd_build_images() {
  local start_time=$SECONDS
  local hash
  hash=$(compute_deps_hash)

  echo -e "${BLUE}🔨 Force-building base images (deps hash: ${hash})...${NC}"
  echo ""

  echo -e "${BLUE}Building backend image...${NC}"
  docker build -t "${BACKEND_IMAGE_NAME}:${hash}" -t "${BACKEND_IMAGE_NAME}:latest" \
    -f "$PROJECT_ROOT/docker/Dockerfile.backend.dev" "$PROJECT_ROOT"
  echo ""

  echo -e "${BLUE}Building dashboard image...${NC}"
  docker build -t "${DASHBOARD_IMAGE_NAME}:${hash}" -t "${DASHBOARD_IMAGE_NAME}:latest" \
    -f "$PROJECT_ROOT/docker/Dockerfile.dashboard.dev" "$PROJECT_ROOT"
  echo ""

  local elapsed=$(( SECONDS - start_time ))
  echo -e "${GREEN}✓ Images built in ${elapsed}s (hash: ${hash})${NC}"
}

detect_runtime() {
  if command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"
    if command -v podman-compose &> /dev/null; then
      COMPOSE_CMD="podman-compose"
    else
      COMPOSE_CMD="podman compose"
    fi
    if ! podman machine list 2>/dev/null | grep -q "Currently running"; then
      echo -e "${YELLOW}⚠️  Podman machine not running. Starting...${NC}"
      podman machine start 2>/dev/null || (podman machine init && podman machine start)
    fi
  elif command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
    if command -v docker-compose &> /dev/null; then
      COMPOSE_CMD="docker-compose"
    else
      COMPOSE_CMD="docker compose"
    fi
    if ! docker info > /dev/null 2>&1; then
      echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
      exit 1
    fi
  else
    echo -e "${RED}❌ Neither Docker nor Podman found.${NC}"
    exit 1
  fi
}

validate_name() {
  local name="$1"
  if [[ -z "$name" ]]; then
    echo -e "${RED}Error: Sandbox name is required.${NC}"
    exit 1
  fi
  if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
    echo -e "${RED}Error: Invalid name '$name'. Use lowercase alphanumeric and hyphens only.${NC}"
    exit 1
  fi
  if [[ ${#name} -gt 30 ]]; then
    echo -e "${RED}Error: Name must be 30 characters or less.${NC}"
    exit 1
  fi
}

to_db_name() {
  echo "sandbox_$(echo "$1" | tr '-' '_')_db"
}

to_underscored() {
  echo "$1" | tr '-' '_'
}

SHARED_INFRA_CONTAINERS=(
  xyne-sandbox-traefik
  xyne-sandbox-postgres
  xyne-sandbox-redis
  xyne-sandbox-livekit
  xyne-sandbox-fake-gcs
  xyne-sandbox-superposition
  xyne-spaces-ysweet
)

# Remove shared-infra containers that exist but aren't healthy-running,
# so the next `up -d` can recreate them cleanly. Leaves per-sandbox
# containers (xyne-sandbox-<name>-backend/dashboard/zero-cache) alone,
# and leaves data volumes intact.
clean_stale_infra() {
  local stale=()
  for svc in "${SHARED_INFRA_CONTAINERS[@]}"; do
    local status
    status=$($CONTAINER_RUNTIME inspect --format '{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
    if [ "$status" != "missing" ] && [ "$status" != "running" ]; then
      stale+=("$svc")
    fi
  done

  if [ ${#stale[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found stale shared-infra containers (${stale[*]}) — force-removing before up -d${NC}"
    for svc in "${stale[@]}"; do
      $CONTAINER_RUNTIME rm -f "$svc" >/dev/null 2>&1 || true
    done
  fi

  # Kill any leftover rootless-port proxy holding :80 that isn't tied to a live container.
  # This is the "proxy already running" error podman emits after a machine restart.
  if command -v lsof >/dev/null 2>&1; then
    local pid
    for pid in $(lsof -nP -iTCP:80 -sTCP:LISTEN -t 2>/dev/null); do
      local comm
      comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ')
      case "$comm" in
        *rootlessport*|*slirp4netns*)
          echo -e "${YELLOW}⚠️  Killing leftover $comm (pid $pid) holding :80${NC}"
          kill "$pid" 2>/dev/null || true
          ;;
      esac
    done
  fi
}

ensure_infra() {
  echo -e "${BLUE}Ensuring shared infrastructure is running...${NC}"
  clean_stale_infra
  $COMPOSE_CMD -f "$PROJECT_ROOT/docker-compose.sandbox.yml" up -d

  echo -e "${BLUE}⏳ Waiting for PostgreSQL...${NC}"
  for i in {1..30}; do
    if $COMPOSE_CMD -f "$PROJECT_ROOT/docker-compose.sandbox.yml" exec -T postgres pg_isready -U xyne > /dev/null 2>&1; then
      echo -e "${GREEN}✓ PostgreSQL ready${NC}"
      break
    fi
    [ $i -eq 30 ] && { echo -e "${RED}❌ PostgreSQL failed to start${NC}"; exit 1; }
    sleep 1
  done

  echo -e "${BLUE}⏳ Waiting for Traefik on :80...${NC}"
  for i in {1..20}; do
    # Traefik with no matching route returns 404, but any HTTP code (not curl's "000" connect-failed)
    # proves the proxy is listening on :80.
    local code
    code=$(curl -so /dev/null -w "%{http_code}" --max-time 2 http://localhost/ 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      echo -e "${GREEN}✓ Traefik ready (HTTP $code)${NC}"
      return
    fi
    if [ $i -eq 20 ]; then
      echo -e "${RED}❌ Traefik failed to bind port 80.${NC}"
      echo -e "${YELLOW}   Something else is holding :80 (another sandbox attempt, rootlessport leftover, local web server, etc.).${NC}"
      echo -e "${YELLOW}   Diagnose:${NC}"
      echo -e "${YELLOW}     lsof -nP -iTCP:80 -sTCP:LISTEN${NC}"
      echo -e "${YELLOW}     ps aux | grep -E 'rootlessport|slirp4netns' | grep -v grep${NC}"
      echo -e "${YELLOW}   Recovery (nuclear):${NC}"
      echo -e "${YELLOW}     podman machine stop && podman machine start${NC}"
      exit 1
    fi
    sleep 1
  done
}

generate_compose() {
  local name="$1"
  local image_hash="$2"
  local db_name
  db_name=$(to_db_name "$name")
  local name_under
  name_under=$(to_underscored "$name")
  local sandbox_dir="$SANDBOXES_DIR/$name"

  # Populate the secrets referenced in the generated compose below. Prefer values
  # already exported in the environment (CI / prod-like runs); otherwise pull them
  # from apps/backend/.env.local (direnv loads this automatically for local dev). Fail
  # fast on the essential ones so we never bake empty auth secrets into a sandbox.
  local _env_local="$PROJECT_ROOT/backend/.env.local"
  local _v _line
  for _v in ZERO_AUTH_SECRET JWT_SECRET GOOGLE_CLIENT_SECRET; do
    if [ -z "$(eval "printf '%s' \"\${$_v:-}\"")" ] && [ -f "$_env_local" ]; then
      _line=$(grep -m1 "^$_v=" "$_env_local" || true)
      if [ -n "$_line" ]; then export "$_v=${_line#*=}"; fi
    fi
  done
  for _v in ZERO_AUTH_SECRET JWT_SECRET; do
    if [ -z "$(eval "printf '%s' \"\${$_v:-}\"")" ]; then
      echo -e "${RED}❌ $_v is not set — export it or populate apps/backend/.env.local before creating a sandbox.${NC}" >&2
      exit 1
    fi
  done

  cat > "$sandbox_dir/docker-compose.yml" << COMPOSE_EOF
services:
  zero-cache:
    image: mirror.gcr.io/rocicorp/zero:0.26.1
    container_name: xyne-sandbox-${name}-zero-cache
    mem_limit: 512m
    environment:
      - ZERO_UPSTREAM_DB=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/${db_name}
      - ZERO_CVR_DB=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/${db_name}
      - ZERO_CHANGE_DB=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/${db_name}
      - ZERO_REPLICA_FILE=/var/zero/replica.db
      - ZERO_LOG_LEVEL=info
      - ZERO_AUTH_SECRET=${ZERO_AUTH_SECRET}
      - ZERO_ADMIN_PASSWORD=dev-admin-password
      - ZERO_MUTATE_URL=http://xyne-sandbox-${name}-backend:3001/api/zero/push
      - ZERO_QUERY_URL=http://xyne-sandbox-${name}-backend:3001/api/zero/query
      - ZERO_QUERY_FORWARD_COOKIES=true
      - ZERO_MUTATE_FORWARD_COOKIES=true
      - ZERO_CVR_MAX_CONNS=3
      - ZERO_UPSTREAM_MAX_CONNS=3
      - ZERO_NUM_SYNC_WORKERS=2
      - NODE_ENV=development
      - ZERO_PORT=4848
      - ZERO_APP_ID=sandbox_${name_under}
    volumes:
      - zero_cache_${name_under}:/var/zero
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}-zero.rule=Host(\`${name}.localhost\`) && PathPrefix(\`/zero\`)"
      - "traefik.http.routers.${name}-zero.priority=20"
      - "traefik.http.services.${name}-zero.loadbalancer.server.port=4848"
    networks:
      - sandbox-net
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4848/"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    image: ${BACKEND_IMAGE_NAME}:${image_hash}
    container_name: xyne-sandbox-${name}-backend
    mem_limit: 1g
    volumes:
      - ./apps/backend:/app
      - ./packages/shared:/shared
      - ./packages/framework:/framework
      - backend_node_modules_${name_under}:/app/node_modules
      - /app/node_modules/.prisma
    environment:
      - NODE_ENV=development
      - PORT=3001
      - HOST=0.0.0.0
      - DATABASE_URL=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/${db_name}?schema=public&connection_limit=5
      - ZERO_UPSTREAM_DB=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/${db_name}
      - REDIS_URL=redis://xyne-sandbox-redis:6379
      - REDIS_HOST=xyne-sandbox-redis
      - REDIS_PORT=6379
      - LIVEKIT_API_KEY=devkey
      - LIVEKIT_API_SECRET=devsecret
      - LIVEKIT_URL=ws://xyne-sandbox-livekit:7880
      - LIVEKIT_CLIENT_URL=http://${name}.localhost
      - LIVEKIT_SERVER_URL=ws://xyne-sandbox-livekit:7880
      - FRONTEND_URL=http://${name}.localhost
      - BACKEND_URL=http://${name}.localhost
      - SLACK_FRONTEND_URL=http://${name}.localhost
      - ZERO_PORT=4848
      - JWT_SECRET=${JWT_SECRET}
      - ZERO_AUTH_SECRET=${ZERO_AUTH_SECRET}
      - CORS_ORIGIN=http://${name}.localhost
      - ENABLE_DEV_AUTH=true
      - LOG_LEVEL=debug
      - GCS_PROJECT_ID=xyne-spaces
      - GCS_BUCKET_NAME=xyne-spaces-chat-documents
      - TRANSCRIPTION_BUCKET_NAME=transcription-dev-v2
      - GCS_CANVAS_BUCKET_NAME=xyne-spaces-canvas-documents
      - SUPERPOSITION_ENDPOINT=http://xyne-sandbox-superposition:8080
      - SUPERPOSITION_TOKEN=MTIzNDU2
      - SUPERPOSITION_ORG_ID=localorg
      - SUPERPOSITION_WORKSPACE_ID=test
      - STORAGE_EMULATOR_HOST=http://xyne-sandbox-fake-gcs:4443
      - CHOKIDAR_USEPOLLING=true
      - GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - DEFAULT_ADMIN_EMAIL=sandbox@xyne.ai
      - JWT_EXPIRATION_SECONDS=86400
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}-backend.rule=Host(\`${name}.localhost\`) && PathPrefix(\`/api\`)"
      - "traefik.http.routers.${name}-backend.priority=20"
      - "traefik.http.services.${name}-backend.loadbalancer.server.port=3001"
    networks:
      - sandbox-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s

  dashboard:
    image: ${DASHBOARD_IMAGE_NAME}:${image_hash}
    container_name: xyne-sandbox-${name}-dashboard
    volumes:
      - ./apps/dashboard:/app
      - ./packages/shared:/shared
      - dashboard_node_modules_${name_under}:/app/node_modules
    environment:
      - VITE_API_URL=http://${name}.localhost/api
      - VITE_API_BASE_URL=http://${name}.localhost
      - VITE_ZERO_SERVER=http://${name}.localhost
      - VITE_ENVIRONMENT=development
      - VITE_LOG_LEVEL=debug
      - VITE_ENABLE_ANALYTICS=false
      - VITE_SHAREABLE_ORIGIN=http://${name}.localhost
      - VITE_OTEL_METRICS_ENDPOINT=http://xyne-sandbox-otel-collector:4318/v1/metrics
      - VITE_OTEL_SERVICE_NAME=xyne-sandbox-${name}
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}-dashboard.rule=Host(\`${name}.localhost\`)"
      - "traefik.http.routers.${name}-dashboard.priority=10"
      - "traefik.http.services.${name}-dashboard.loadbalancer.server.port=5173"
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - sandbox-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5173/"]
      interval: 10s
      timeout: 5s
      retries: 25
      start_period: 30s

volumes:
  zero_cache_${name_under}:
    driver: local
  backend_node_modules_${name_under}:
    driver: local
  dashboard_node_modules_${name_under}:
    driver: local

networks:
  sandbox-net:
    external: true
COMPOSE_EOF
}

generate_config() {
  local name="$1"
  local sandbox_dir="$SANDBOXES_DIR/$name"
  local db_name
  db_name=$(to_db_name "$name")

  local name_under
  name_under=$(to_underscored "$name")

  cat > "$sandbox_dir/.sandbox.json" << EOF
{
  "name": "$name",
  "branch": "sandbox/$name",
  "urls": {
    "dashboard": "http://$name.localhost",
    "backend": "http://$name.localhost/api",
    "zero": "http://$name.localhost/zero"
  },
  "database": {
    "name": "$db_name",
    "url": "postgresql://xyne:xyne123@localhost:5433/$db_name"
  },
  "containers": {
    "backend": "xyne-sandbox-$name-backend",
    "dashboard": "xyne-sandbox-$name-dashboard",
    "zero_cache": "xyne-sandbox-$name-zero-cache"
  },
  "zero_app_id": "sandbox_${name_under}",
  "worktree_path": ".sandboxes/$name",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "running"
}
EOF

  cat > "$sandbox_dir/.env.sandbox" << EOF
SANDBOX_NAME=$name
DATABASE_URL=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/$db_name?schema=public
ZERO_UPSTREAM_DB=postgresql://xyne:xyne123@xyne-sandbox-postgres:5432/$db_name
ZERO_APP_ID=sandbox_${name_under}
BACKEND_URL=http://$name.localhost
FRONTEND_URL=http://$name.localhost
ZERO_CACHE_URL=http://$name.localhost/zero
REDIS_URL=redis://xyne-sandbox-redis:6379
LIVEKIT_URL=ws://xyne-sandbox-livekit:7880
STORAGE_EMULATOR_HOST=http://xyne-sandbox-fake-gcs:4443
EOF
}

cmd_create() {
  local name="$1"
  validate_name "$name"

  local sandbox_dir="$SANDBOXES_DIR/$name"
  local db_name
  db_name=$(to_db_name "$name")

  if [ -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' already exists${NC}"
    exit 1
  fi

  echo -e "${BLUE}🔧 Creating sandbox: $name${NC}"
  echo ""

  ensure_infra
  ensure_images

  echo -e "${BLUE}📁 Creating git worktree...${NC}"
  mkdir -p "$SANDBOXES_DIR"
  git -C "$PROJECT_ROOT" worktree add "$sandbox_dir" -b "sandbox/$name"
  echo -e "${GREEN}✓ Worktree created at .sandboxes/$name (branch: sandbox/$name)${NC}"

  echo -e "${BLUE}🗄️  Creating database: $db_name${NC}"
  docker exec xyne-sandbox-postgres psql -U xyne -d postgres -c "CREATE DATABASE $db_name;" 2>/dev/null || \
    echo -e "${YELLOW}⚠️  Database may already exist${NC}"
  echo -e "${GREEN}✓ Database created${NC}"

  echo -e "${BLUE}📦 Building shared dependencies in worktree...${NC}"
  (cd "$sandbox_dir/shared" && pnpm install --prefer-offline --no-audit --no-fund 2>&1 | tail -1 && pnpm run build) 2>&1 | tail -3
  echo -e "${GREEN}✓ shared module built${NC}"
  (cd "$sandbox_dir/framework" && pnpm install --prefer-offline --no-audit --no-fund 2>&1 | tail -1 && pnpm run build) 2>&1 | tail -3
  echo -e "${GREEN}✓ framework module built${NC}"

  echo -e "${BLUE}📝 Generating sandbox compose file...${NC}"
  generate_compose "$name" "$CURRENT_IMAGE_HASH"
  echo -e "${GREEN}✓ Compose file generated${NC}"

  echo -e "${BLUE}🚀 Starting sandbox containers...${NC}"
  $COMPOSE_CMD -f "$sandbox_dir/docker-compose.yml" up -d

  echo -e "${BLUE}⏳ Waiting for backend to become healthy...${NC}"
  for i in {1..90}; do
    if docker exec "xyne-sandbox-${name}-backend" curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Backend is healthy${NC}"
      break
    fi
    if [ $i -eq 90 ]; then
      echo -e "${YELLOW}⚠️  Backend still starting. Check logs: pnpm run sandbox -- logs $name backend${NC}"
      break
    fi
    sleep 5
  done

  echo -e "${BLUE}🌱 Seeding ACL system...${NC}"
  docker exec "xyne-sandbox-${name}-backend" pnpm exec tsx scripts/seed-acl.ts 2>/dev/null || \
    echo -e "${YELLOW}⚠️  ACL seed skipped or already done${NC}"
  echo -e "${GREEN}✓ ACL seeded${NC}"

  echo -e "${BLUE}👑 Assigning sandbox admin (sandbox@xyne.ai)...${NC}"
  docker exec "xyne-sandbox-${name}-backend" pnpm exec tsx scripts/assign-admin-user.ts sandbox@xyne.ai 2>/dev/null || \
    echo -e "${YELLOW}⚠️  Admin assignment skipped${NC}"
  echo -e "${GREEN}✓ Admin assigned${NC}"

  generate_config "$name"

  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}✅ Sandbox '$name' is ready!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "${BLUE}URLs:${NC}"
  echo -e "  🖥️  Dashboard:  ${GREEN}http://$name.localhost${NC}"
  echo -e "  🔧 Backend:    ${GREEN}http://$name.localhost/api${NC}"
  echo -e "  ⚡ Zero Cache: ${GREEN}http://$name.localhost/zero${NC}"
  echo ""
  echo -e "${BLUE}Source code:${NC}  .sandboxes/$name/"
  echo -e "${BLUE}Git branch:${NC}   sandbox/$name"
  echo -e "${BLUE}Database:${NC}     $db_name"
  echo ""
}

cmd_stop() {
  local name="$1"
  validate_name "$name"
  local sandbox_dir="$SANDBOXES_DIR/$name"

  if [ ! -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' not found${NC}"
    exit 1
  fi

  echo -e "${BLUE}⏸️  Stopping sandbox: $name${NC}"
  $COMPOSE_CMD -f "$sandbox_dir/docker-compose.yml" stop
  echo -e "${GREEN}✓ Sandbox '$name' stopped (data preserved)${NC}"
}

cmd_start() {
  local name="$1"
  validate_name "$name"
  local sandbox_dir="$SANDBOXES_DIR/$name"

  if [ ! -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' not found${NC}"
    exit 1
  fi

  echo -e "${BLUE}▶️  Starting sandbox: $name${NC}"
  ensure_infra
  $COMPOSE_CMD -f "$sandbox_dir/docker-compose.yml" start
  echo -e "${GREEN}✓ Sandbox '$name' started${NC}"
  echo ""
  echo -e "  🖥️  Dashboard:  ${GREEN}http://$name.localhost${NC}"
  echo -e "  🔧 Backend:    ${GREEN}http://$name.localhost/api${NC}"
  echo -e "  ⚡ Zero Cache: ${GREEN}http://$name.localhost/zero${NC}"
}

cmd_destroy() {
  local name="$1"
  validate_name "$name"
  local sandbox_dir="$SANDBOXES_DIR/$name"
  local db_name
  db_name=$(to_db_name "$name")
  local name_under
  name_under=$(to_underscored "$name")

  if [ ! -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' not found${NC}"
    exit 1
  fi

  echo -e "${RED}🗑️  Destroying sandbox: $name${NC}"

  echo -e "${BLUE}Removing containers and volumes...${NC}"
  $COMPOSE_CMD -f "$sandbox_dir/docker-compose.yml" down -v 2>/dev/null || true

  echo -e "${BLUE}Cleaning up replication slots...${NC}"
  docker exec xyne-sandbox-postgres psql -U xyne -d postgres -c \
    "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE '%sandbox_${name_under}%';" 2>/dev/null || true

  echo -e "${BLUE}Dropping database: $db_name${NC}"
  docker exec xyne-sandbox-postgres psql -U xyne -d postgres -c \
    "DROP DATABASE IF EXISTS $db_name;" 2>/dev/null || true

  echo -e "${BLUE}Removing git worktree...${NC}"
  rm -rf "$sandbox_dir"
  git -C "$PROJECT_ROOT" worktree prune
  git -C "$PROJECT_ROOT" branch -D "sandbox/$name" 2>/dev/null || true

  echo -e "${GREEN}✓ Sandbox '$name' destroyed${NC}"
}

cmd_list() {
  if [ ! -d "$SANDBOXES_DIR" ] || [ -z "$(ls -A "$SANDBOXES_DIR" 2>/dev/null)" ]; then
    echo -e "${YELLOW}No sandboxes found.${NC}"
    echo -e "Create one with: ${BLUE}pnpm run sandbox -- create <name>${NC}"
    return
  fi

  echo -e "${BLUE}📦 Sandboxes:${NC}"
  echo ""
  printf "  %-20s %-10s %-35s %-35s\n" "NAME" "STATUS" "DASHBOARD" "BACKEND"
  printf "  %-20s %-10s %-35s %-35s\n" "----" "------" "---------" "-------"

  for dir in "$SANDBOXES_DIR"/*/; do
    [ ! -d "$dir" ] && continue
    local name
    name=$(basename "$dir")
    local status="stopped"
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "xyne-sandbox-${name}-backend"; then
      status="running"
    fi
    local status_color=$RED
    [ "$status" = "running" ] && status_color=$GREEN
    printf "  %-20s ${status_color}%-10s${NC} %-35s %-35s\n" \
      "$name" "$status" "http://$name.localhost" "http://$name.localhost/api"
  done
  echo ""
}

cmd_logs() {
  local name="$1"
  local service="${2:-}"
  validate_name "$name"
  local sandbox_dir="$SANDBOXES_DIR/$name"

  if [ ! -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' not found${NC}"
    exit 1
  fi

  $COMPOSE_CMD -f "$sandbox_dir/docker-compose.yml" logs -f $service
}

cmd_status() {
  local name="$1"
  validate_name "$name"
  local sandbox_dir="$SANDBOXES_DIR/$name"
  local db_name
  db_name=$(to_db_name "$name")

  if [ ! -d "$sandbox_dir" ]; then
    echo -e "${RED}Error: Sandbox '$name' not found${NC}"
    exit 1
  fi

  echo -e "${BLUE}📊 Sandbox: $name${NC}"
  echo ""

  echo -e "${BLUE}Containers:${NC}"
  for svc in backend dashboard zero-cache; do
    local container="xyne-sandbox-${name}-${svc}"
    local status
    status=$(docker ps --format '{{.Status}}' --filter "name=^/${container}$" 2>/dev/null)
    if [ -n "$status" ]; then
      echo -e "  ${svc}: ${GREEN}${status}${NC}"
    else
      echo -e "  ${svc}: ${RED}stopped${NC}"
    fi
  done
  echo ""

  echo -e "${BLUE}Database:${NC}"
  if docker exec xyne-sandbox-postgres psql -U xyne -d postgres -t -c \
    "SELECT 1 FROM pg_database WHERE datname='$db_name'" 2>/dev/null | grep -q 1; then
    echo -e "  $db_name: ${GREEN}exists${NC}"
  else
    echo -e "  $db_name: ${RED}not found${NC}"
  fi
  echo ""

  echo -e "${BLUE}URLs:${NC}"
  echo -e "  Dashboard:  http://$name.localhost"
  echo -e "  Backend:    http://$name.localhost/api"
  echo -e "  Zero Cache: http://$name.localhost/zero"
  echo ""

  echo -e "${BLUE}Git:${NC}"
  echo -e "  Branch:   sandbox/$name"
  echo -e "  Worktree: .sandboxes/$name/"
}

cmd_exec() {
  local name="$1"
  shift
  local service="${1:-backend}"
  if [ "$service" = "backend" ] || [ "$service" = "dashboard" ]; then
    shift
  else
    service="backend"
  fi
  validate_name "$name"
  local container="xyne-sandbox-${name}-${service}"

  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo -e "${RED}Error: Container '$container' is not running${NC}"
    exit 1
  fi

  local tty_flag=""
  [ -t 0 ] && tty_flag="-t"
  docker exec -i $tty_flag "$container" "$@"
}

cmd_infra() {
  local action="${1:-up}"
  local profile="${2:-}"
  case "$action" in
    up)
      echo -e "${BLUE}🚀 Starting shared infrastructure...${NC}"
      if [ "$profile" = "monitoring" ]; then
        echo -e "${BLUE}  Including monitoring stack (Grafana, VictoriaMetrics, OTEL)...${NC}"
        $COMPOSE_CMD -f "$PROJECT_ROOT/docker-compose.sandbox.yml" --profile monitoring up -d
      else
        ensure_infra
      fi
      echo -e "${GREEN}✓ Shared infrastructure is running${NC}"
      ;;
    down)
      echo -e "${BLUE}🛑 Stopping shared infrastructure...${NC}"
      $COMPOSE_CMD -f "$PROJECT_ROOT/docker-compose.sandbox.yml" --profile monitoring down
      echo -e "${GREEN}✓ Shared infrastructure stopped${NC}"
      ;;
    *)
      echo -e "${RED}Usage: sandbox infra [up|down] [monitoring]${NC}"
      exit 1
      ;;
  esac
}

cmd_reset() {
  echo -e "${YELLOW}🧹 Resetting shared sandbox state (keeps data volumes and per-sandbox containers)...${NC}"

  # Force-remove shared-infra containers
  for svc in "${SHARED_INFRA_CONTAINERS[@]}"; do
    $CONTAINER_RUNTIME rm -f "$svc" >/dev/null 2>&1 || true
  done

  # Remove podman-compose pods that contain only shared infra
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    for pod in $($CONTAINER_RUNTIME pod ps --format "{{.Name}}" 2>/dev/null); do
      local members
      members=$($CONTAINER_RUNTIME pod inspect "$pod" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "")
      # Only nuke pods that mention shared-infra names and NOT per-sandbox names
      if echo "$members" | grep -qE "xyne-sandbox-(traefik|postgres|redis|livekit|fake-gcs|superposition)|xyne-spaces-ysweet" && \
         ! echo "$members" | grep -qE "xyne-sandbox-[a-z0-9-]+-(backend|dashboard|zero-cache)"; then
        $CONTAINER_RUNTIME pod rm -f "$pod" >/dev/null 2>&1 || true
      fi
    done
  fi

  # Kill leftover rootlessport / slirp4netns procs holding :80
  if command -v lsof >/dev/null 2>&1; then
    for pid in $(lsof -nP -iTCP:80 -sTCP:LISTEN -t 2>/dev/null); do
      local comm
      comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ')
      case "$comm" in
        *rootlessport*|*slirp4netns*)
          echo -e "${YELLOW}  Killing leftover $comm (pid $pid) holding :80${NC}"
          kill -TERM "$pid" 2>/dev/null || true
          ;;
      esac
    done
  fi

  # Remove the sandbox-net network if nothing is attached
  $CONTAINER_RUNTIME network rm sandbox-net >/dev/null 2>&1 || true

  echo -e "${GREEN}✓ Reset complete. Run 'pnpm run sandbox -- create <name>' to rebuild shared infra.${NC}"
  echo -e "${BLUE}   Data volumes preserved: sandbox_postgres_data, sandbox_redis_data, sandbox_fake_gcs_data.${NC}"
  echo -e "${BLUE}   For a total wipe including data, use: pnpm run sandbox -- destroy-all && podman volume prune${NC}"
}

cmd_stop_all() {
  if [ ! -d "$SANDBOXES_DIR" ] || [ -z "$(ls -A "$SANDBOXES_DIR" 2>/dev/null)" ]; then
    echo -e "${YELLOW}No sandboxes found.${NC}"
    return
  fi

  echo -e "${BLUE}⏸️  Stopping all sandboxes...${NC}"
  for dir in "$SANDBOXES_DIR"/*/; do
    [ ! -d "$dir" ] && continue
    local name
    name=$(basename "$dir")
    if [ -f "$dir/docker-compose.yml" ]; then
      echo -e "${BLUE}  Stopping $name...${NC}"
      $COMPOSE_CMD -f "$dir/docker-compose.yml" stop 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}✓ All sandboxes stopped${NC}"
}

cmd_destroy_all() {
  if [ ! -d "$SANDBOXES_DIR" ] || [ -z "$(ls -A "$SANDBOXES_DIR" 2>/dev/null)" ]; then
    echo -e "${YELLOW}No sandboxes found.${NC}"
    return
  fi

  local names=()
  for dir in "$SANDBOXES_DIR"/*/; do
    [ ! -d "$dir" ] && continue
    names+=($(basename "$dir"))
  done

  echo -e "${RED}⚠️  This will destroy ${#names[@]} sandbox(es): ${names[*]}${NC}"
  echo -e "${RED}   All containers, volumes, databases, worktrees, and branches will be removed.${NC}"
  read -p "Are you sure? (y/N) " confirm
  [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && { echo "Cancelled."; return; }

  for name in "${names[@]}"; do
    echo ""
    cmd_destroy "$name"
  done
  echo ""
  echo -e "${GREEN}✓ All sandboxes destroyed${NC}"
}

detect_runtime

case "${1:-}" in
  create)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox create <name>${NC}"; exit 1; }
    cmd_create "$2"
    ;;
  stop)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox stop <name>${NC}"; exit 1; }
    cmd_stop "$2"
    ;;
  start)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox start <name>${NC}"; exit 1; }
    cmd_start "$2"
    ;;
  destroy)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox destroy <name>${NC}"; exit 1; }
    cmd_destroy "$2"
    ;;
  list|ls)
    cmd_list
    ;;
  stop-all)
    cmd_stop_all
    ;;
  destroy-all)
    cmd_destroy_all
    ;;
  logs)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox logs <name> [service]${NC}"; exit 1; }
    cmd_logs "$2" "${3:-}"
    ;;
  status)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox status <name>${NC}"; exit 1; }
    cmd_status "$2"
    ;;
  exec)
    [ -z "${2:-}" ] && { echo -e "${RED}Usage: sandbox exec <name> [backend|dashboard] <command...>${NC}"; exit 1; }
    name="$2"; shift 2
    cmd_exec "$name" "$@"
    ;;
  infra)
    cmd_infra "${2:-up}" "${3:-}"
    ;;
  build-images)
    cmd_build_images
    ;;
  reset)
    cmd_reset
    ;;
  *)
    echo -e "${BLUE}Xyne Sandbox Manager${NC}"
    echo ""
    echo "Usage: sandbox <command> [args]"
    echo ""
    echo "Commands:"
    echo "  create <name>         Create a new sandbox environment"
    echo "  stop <name>           Stop sandbox containers (preserves data)"
    echo "  start <name>          Start a stopped sandbox"
    echo "  destroy <name>        Destroy sandbox (removes everything)"
    echo "  stop-all              Stop all running sandboxes"
    echo "  destroy-all           Destroy all sandboxes (with confirmation)"
    echo "  list                  List all sandboxes"
    echo "  logs <name> [service] Tail sandbox logs"
    echo "  status <name>         Show detailed sandbox status"
    echo "  exec <name> [svc] cmd Run command inside sandbox container"
    echo "  infra [up|down] [monitoring]  Manage shared infrastructure"
    echo "  build-images          Force rebuild base Docker images"
    echo "  reset                 Force-clean stuck shared infra (keeps data volumes)"
    echo ""
    echo "Examples:"
    echo "  pnpm run sandbox -- create agent-1"
    echo "  pnpm run sandbox -- list"
    echo "  pnpm run sandbox -- logs agent-1 backend"
    echo "  pnpm run sandbox -- destroy agent-1"
    ;;
esac
