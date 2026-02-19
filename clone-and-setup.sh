#!/usr/bin/env bash
set -euo pipefail

#######################################
# CONFIG
#######################################
CLONE_URL="ssh://git@github.com/example-org/xyne-spaces.git"
REPO_DIR="/tmp/xyne-spaces"
STATUS_FILE="/tmp/xyne-setup-status.json"

#######################################
# COLORS
#######################################
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

#######################################
# STATUS FUNCTIONS
#######################################
update_status() {
  local stage=$1
  local status=$2
  local message=$3
  local services_json=${4:-[]}
  
  cat > "$STATUS_FILE" << EOF
{
  "stage": "$stage",
  "status": "$status",
  "message": "$message",
  "timestamp": $(date +%s),
  "stages": {
    "clone": {"status": "pending", "message": ""},
    "checkout": {"status": "pending", "message": ""},
    "dependencies": {"status": "pending", "message": ""},
    "services": {"status": "pending", "message": "", "healthy": false, "services": []},
    "backend": {"status": "pending", "message": ""},
    "dashboard": {"status": "pending", "message": ""}
  }
}
EOF
}

update_stage_status() {
  local stage=$1
  local status=$2
  local message=$3
  local services_json=${4:-"[]"}
  local services_healthy=${5:-"false"}
  
  if [ -f "$STATUS_FILE" ]; then
    # Read current status and update the specific stage
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
  fi
}

validate_arguments() {
  if [ $# -eq 0 ]; then
    echo -e "${RED}❌ Branch name is required!${NC}"
    echo ""
    echo "Usage: $0 <branch-name>"
    echo ""
    echo "Example:"
    echo "  $0 feature/my-feature"
    echo "  $0 develop"
    exit 1
  fi
}

BRANCH_NAME="$1"

# Initialize status file
update_status "clone" "in_progress" "Initializing setup..."

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════╗"
echo "║   Clone and Setup Script                      ║"
echo "╚════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${CYAN}ℹ  Repository:${NC} $CLONE_URL"
echo -e "${CYAN}ℹ  Branch:${NC} $BRANCH_NAME"
echo -e "${CYAN}ℹ  Target Directory:${NC} $REPO_DIR"
echo ""

# Step 1: Clean up existing directory if it exists
if [ -d "$REPO_DIR" ]; then
  echo -e "${BLUE}▶ Removing existing directory $REPO_DIR ...${NC}"
  rm -rf "$REPO_DIR"
  echo -e "${GREEN}✅ Existing directory removed${NC}"
  echo ""
fi

# Step 2: Clone the repository with specific branch
echo -e "${BLUE}▶ Cloning repository (branch: $BRANCH_NAME)...${NC}"
update_stage_status "clone" "in_progress" "Cloning repository..."

if git clone -b "$BRANCH_NAME" --single-branch "$CLONE_URL" "$REPO_DIR"; then
  echo -e "${GREEN}✅ Repository cloned successfully with branch '$BRANCH_NAME'${NC}"
  update_stage_status "clone" "completed" "Repository cloned successfully with branch '$BRANCH_NAME'"
else
  echo -e "${RED}❌ Failed to clone repository${NC}"
  update_stage_status "clone" "failed" "Failed to clone repository"
  sync  # Ensure status is flushed to disk before exiting
  exit 1
fi
echo ""

# Step 3: Verify branch (already checked out by clone command)
echo -e "${BLUE}▶ Verifying branch '$BRANCH_NAME'...${NC}"
update_stage_status "checkout" "in_progress" "Verifying branch..."
cd "$REPO_DIR"

# Verify we're on the correct branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "$BRANCH_NAME" ]; then
  echo -e "${GREEN}✅ Successfully verified branch '$BRANCH_NAME'${NC}"
  update_stage_status "checkout" "completed" "Successfully verified branch '$BRANCH_NAME'"
else
  echo -e "${RED}❌ Branch mismatch. Expected '$BRANCH_NAME' but got '$CURRENT_BRANCH'${NC}"
  update_stage_status "checkout" "failed" "Branch verification failed"
  sync  # Ensure status is flushed to disk before exiting
  exit 1
fi
echo ""

# Step 4: Mark dependencies as starting (setup.sh will handle this)
update_stage_status "dependencies" "in_progress" "Installing dependencies..."

# Step 5: Run setup.sh
echo -e "${BLUE}▶ Running setup.sh...${NC}"
update_stage_status "services" "in_progress" "Starting services..."

echo ""
if [ -f "./setup.sh" ]; then
  chmod +x ./setup.sh
  exec ./setup.sh
else
  echo -e "${RED}❌ setup.sh not found in $REPO_DIR${NC}"
  update_stage_status "services" "failed" "setup.sh not found"
  sync  # Ensure status is flushed to disk before exiting
  exit 1
fi