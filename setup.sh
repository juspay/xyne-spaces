#!/usr/bin/env bash
set -euo pipefail

#######################################
# CONFIG
#######################################
INFRA_CMD="nix run .#xyne-space-services"
BACKEND_DIR="backend"
DASHBOARD_DIR="dashboard"
STATUS_FILE="/tmp/xyne-setup-status.json"

TIMEOUT=120  # seconds
POLL_INTERVAL=2  # seconds

# Services to monitor (must be HEALTHY)
# Format: "service_name|host|port"
REQUIRED_SERVICES=(
  "postgres.xyne-db|127.0.0.1|5433"
  "xyne-redis|127.0.0.1|6379"
  "xyne-zero|127.0.0.1|4848"
  "collab.ysweet|127.0.0.1|8080"
  "storage.fake-gcs|127.0.0.1|4443"
)

#######################################
# STATUS FUNCTIONS
#######################################
update_stage_status() {
  local stage=$1
  local status=$2
  local message=$3
  local services_json=${4:-"[]"}
  local services_healthy=${5:-"false"}
  
  if [ -f "$STATUS_FILE" ]; then
    local current_content=$(cat "$STATUS_FILE")
    local updated_content=$(echo "$current_content" | jq --arg stg "$stage" --arg sts "$status" --arg msg "$message" --arg svc "$services_json" --arg healthy "$services_healthy" '
      .stages[$stg].status = $sts |
      .stages[$stg].message = $msg |
      if $stg == "services" then
        .stages[$stg].services = ($svc | fromjson) |
        .stages[$stg].healthy = ($healthy == "true")
      else
        .
      end
    ')
    echo "$updated_content" > "$STATUS_FILE"
    sync  # Ensure status is written to disk immediately
  fi
}

build_services_json() {
  local json="["
  local first=true
  for service_config in "${REQUIRED_SERVICES[@]}"; do
    IFS='|' read -r name host port <<< "$service_config"
    if check_port "$host" "$port"; then
      local status="running"
    else
      local status="stopped"
    fi
    if [ "$first" = true ]; then
      first=false
    else
      json="$json,"
    fi
    json="$json{\"name\":\"$name\",\"host\":\"$host\",\"port\":$port,\"status\":\"$status\"}"
  done
  json="$json]"
  echo "$json"
}

#######################################
# COLORS
#######################################
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

#######################################
# FUNCTIONS
#######################################
print_step () {
  echo -e "${BLUE}▶ $1${NC}"
}

print_success () {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error () {
  echo -e "${RED}❌ $1${NC}"
}

print_warning () {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

cleanup_npx_cache () {
  local npx_cache_dir=$(ls -d ~/.npm/_npx/* 2>/dev/null | head -1)
  if [ -n "$npx_cache_dir" ]; then
    print_step "Cleaning npx cache to avoid architecture mismatch..."
    rm -rf "$npx_cache_dir"
    print_success "npx cache cleaned"
  fi
}

check_port () {
  local host=$1
  local port=$2
  
  # Use nc (netcat) to check if port is open
  nc -z "$host" "$port" 2>/dev/null
}

check_service_health () {
  local service_config=$1
  local name host port
  IFS='|' read -r name host port <<< "$service_config"
  
  # Port-based health check
  if check_port "$host" "$port"; then
    return 0  # Port is open, assume healthy
  else
    return 2  # Not accessible yet
  fi
}

show_failed_logs () {
  local service_name=$1
  # Determine log file name from service name
  # postgres.xyne-db -> xyne-db.log
  # storage.fake-gcs -> fake-gcs.log
  # collab.ysweet -> ysweet.log
  local log_name
  case "$service_name" in
    postgres.xyne-db)
      log_name="xyne-db.log"
      ;;
    storage.fake-gcs)
      log_name="fake-gcs.log"
      ;;
    collab.ysweet)
      log_name="ysweet.log"
      ;;
    ai.transcription-agent)
      log_name="transcription-agent.log"
      ;;
    *)
      log_name="${service_name##*.}.log"
      ;;
  esac
  
  local log_file=".logs/$log_name"
  
  print_error "Logs for $service_name:"
  echo ""
  if [ -f "$log_file" ]; then
    # Show last 50 lines
    tail -50 "$log_file" | while IFS= read -r line; do
      echo "  $line"
    done
  else
    echo "  (Log file not found at $log_file)"
  fi
}

#######################################
# MAIN SCRIPT
#######################################
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════╗"
echo "║   Xyne Spaces Development Setup                ║"
echo "╚════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Step 1: Cleanup
print_step "Cleaning up existing processes and ports..."
pkill -f process-compose 2>/dev/null || true
PORTS=(5433 6379 7880 4848 4849 8080 4443 8001 5173 3001)
for port in "${PORTS[@]}"; do
  lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
print_success "Ports cleaned"
echo ""

# Step 2: Cleanup npx cache (fixes arm64/x64 architecture issues)
cleanup_npx_cache
echo ""

# Step 3: Create directories
print_step "Creating necessary directories..."
mkdir -p data/zero-cache data/ysweet data/fake-gcs .logs .nix-cache
print_success "Directories created"
echo ""

# Update dependencies status
update_stage_status "dependencies" "in_progress" "Installing shared dependencies..."

# Step 3.5: Install shared dependencies (needed by backend postinstall)
print_step "Installing shared dependencies..."
cd shared
print_step "Removing existing shared dependencies..."
rm -rf node_modules
print_success "Existing shared dependencies removed"
npm install
cd ..
print_success "Shared dependencies installed"
echo ""

update_stage_status "dependencies" "in_progress" "Framework dependencies completed. Installing backend dependencies..."

# Step 3.6: Install framework dependencies (needed by backend postinstall)
print_step "Installing framework dependencies..."
cd framework
print_step "Removing existing framework dependencies..."
rm -rf node_modules
print_success "Existing framework dependencies removed"
npm install
cd ..
print_success "Framework dependencies installed"
echo ""

update_stage_status "dependencies" "in_progress" "Backend dependencies being installed..."

# Step 4: Install backend dependencies
print_step "Installing backend dependencies..."
cd backend
print_step "Removing existing backend dependencies..."
rm -rf node_modules
print_success "Existing backend dependencies removed"
npm install
cd ..
print_success "Backend dependencies installed"
echo ""

update_stage_status "dependencies" "completed" "All dependencies installed"
sync  # Ensure the status file is flushed to disk

# Step 5: Start infrastructure services in new Terminal window
print_step "Starting infrastructure services in new Terminal window..."
echo "  Running: $INFRA_CMD"
echo ""

update_stage_status "services" "in_progress" "Starting services..."

# Get absolute path to project directory
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Open infrastructure in a new Terminal window with GUI/TUI enabled
print_step "Starting infrastructure services in new Terminal window..."

osascript <<EOF >/dev/null 2>&1
tell application "Terminal"
    activate

    -- Create ONE window for infra
    set infraWindow to do script "cd '$PROJECT_DIR' && $INFRA_CMD"

    -- Give it a custom title (optional but useful)
    set custom title of infraWindow to "Xyne Infra"
end tell
EOF

sleep 3
print_success "Infrastructure services started in Terminal window"
echo ""

# Step 6: Monitor service health (port-based only)
print_step "Waiting for required services to be healthy..."
echo ""
echo "  Required services:"
for service in "${REQUIRED_SERVICES[@]}"; do
  IFS='|' read -r name host port <<< "$service"
  echo "    - $name (port $port)"
done
echo ""

elapsed=0
while [ $elapsed -lt $TIMEOUT ]; do
  all_healthy=true
  
  echo -en "\r${CYAN}Checking services... ($elapsed/${TIMEOUT}s)${NC} (using port checks)"
  
  # Build services JSON for status update
  services_json=$(build_services_json)
  
  # Update services status
  if [ "$all_healthy" = true ]; then
    update_stage_status "services" "in_progress" "All services healthy!" "$services_json" "true"
  else
    update_stage_status "services" "in_progress" "Waiting for services..." "$services_json" "false"
  fi
  
  echo ""
  
  # Check each required service
  for service in "${REQUIRED_SERVICES[@]}"; do
    IFS='|' read -r name host port <<< "$service"
    
    if ! check_service_health "$service"; then
      all_healthy=false
    fi
  done
  
  # Final update for this iteration
  if [ "$all_healthy" = true ]; then
    update_stage_status "services" "in_progress" "All services healthy!" "$(build_services_json)" "true"
  else
    update_stage_status "services" "in_progress" "Waiting for services..." "$(build_services_json)" "false"
  fi
  
  # Show current service status
  echo "  Service status:"
  for service in "${REQUIRED_SERVICES[@]}"; do
    IFS='|' read -r name host port <<< "$service"
    if check_port "$host" "$port"; then
      echo -e "    ${GREEN}✓${NC} $name : port $port is ${GREEN}OPEN${NC}"
    else
      echo -e "    ${YELLOW}○${NC} $name : port $port is ${YELLOW}checking...${NC}"
    fi
  done
  echo ""
  
  # If all services are healthy
  if [ "$all_healthy" = true ]; then
    print_success "All required services are healthy!"
    echo ""
    
    services_json=$(build_services_json)
    update_stage_status "services" "completed" "All services are healthy" "$services_json" "true"
    sync  # Ensure status is flushed before proceeding
    
    echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✨ Infrastructure is ready!                  ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Step: Clean database and seed dummy data
    print_step "Cleaning database and seeding dummy data..."
    update_stage_status "seeding" "in_progress" "Cleaning database and seeding dummy data..."
    sync
    
    cd backend
    
    # # Clean database with force reset
    # echo "  Cleaning database (this may take a moment)..."
    # if npx dotenv -e .env.local -- npx prisma db push --force-reset --accept-data-loss --skip-generate; then
    #   print_success "Database cleaned successfully"
    # else
    #   print_error "Failed to clean database"
    #   echo -e "${YELLOW}  ⚠️  Attempting to continue anyway...${NC}"
    # fi
    
    # # Re-seed ACL system after cleaning
    # echo "  Re-seeding ACL system..."
    # if npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts; then
    #   print_success "ACL system re-seeded"
    # else
    #   print_error "Failed to re-seed ACL system"
    #   echo -e "${YELLOW}  ⚠️  Attempting to continue...${NC}"
    # fi
    
    # Seed dummy data
    echo "  Running dummy seeding script..."
    if npx dotenv -e .env.local -- npx tsx scripts/dummy-seed.ts; then
      print_success "Dummy data seeded successfully"
    else
      print_error "Failed to seed dummy data"
      echo -e "${YELLOW}  ⚠️  Continuing anyway (backend may work without dummy data)${NC}"
    fi
    
    cd ..
    echo ""
    
    update_stage_status "seeding" "completed" "Database cleaned and dummy data seeded"
    sync
    
    # Open backend in a new tab of the same Terminal window
    update_stage_status "backend" "in_progress" "Starting backend server..."
    sync
    
    print_step "Opening backend in Terminal (new tab)..."

osascript <<EOF >/dev/null 2>&1
tell application "Terminal"
    activate

    -- Always reuse the FRONT window (infra window)
    tell front window
        do script "cd '$PROJECT_DIR/backend' && npm run dev"
    end tell
end tell
EOF

    sleep 2

    update_stage_status "backend" "completed" "Backend server running in Terminal tab"
    sync
    
    # Open dashboard in a new tab of the same Terminal window
    update_stage_status "dashboard" "in_progress" "Starting dashboard server..."
    
    print_step "Opening dashboard in Terminal (new tab)..."

osascript <<EOF >/dev/null 2>&1
tell application "Terminal"
    activate

    tell front window
        do script "cd '$PROJECT_DIR/dashboard' && rm -rf node_modules/.vite && npm install && npm run dev"
    end tell
end tell
EOF


    sleep 2
    
    update_stage_status "dashboard" "completed" "Dashboard server running in Terminal tab"
    sync
    
    print_success "All terminals opened!"
    echo ""
    echo -e "${CYAN}💡 Tips:${NC}"
    echo "  • Infrastructure, Backend, and Dashboard are running in grouped Terminal tabs"
    echo "  • The infrastructure services have GUI/TUI enabled"
    echo "  • Press Ctrl+C in the infrastructure tab to stop services"
    echo "  • Or use 'just cleanup' to clean up everything"
    echo "  • Service logs are in the .logs/ directory"
    echo ""
    
    print_success "Setup complete. Services started in background."
    exit 0
  fi
  
  sleep $POLL_INTERVAL
  elapsed=$((elapsed + POLL_INTERVAL))
done

# Timeout reached
print_error "Timeout: Services did not become healthy within ${TIMEOUT}s"
echo ""
services_json=$(build_services_json)
update_stage_status "services" "failed" "Timeout: Services did not become healthy within ${TIMEOUT}s" "$services_json" "false"
print_warning "To debug, check the logs in .logs/ directory"
exit 1