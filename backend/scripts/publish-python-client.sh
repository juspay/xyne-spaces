#!/bin/bash
#
# Publish Python Client to xyne-query-python repo
#
# Usage:
#   ./scripts/publish-python-client.sh [--bump patch|minor|major]
#
# This script:
# 1. Generates fresh DMMF from schema.prisma
# 2. Clones xyne-query-python repo
# 3. Bumps version (default: patch)
# 4. Generates new Python client
# 5. Commits and pushes to Bitbucket
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="$(dirname "$BACKEND_DIR")"

# Configuration
REPO_URL="${XYNE_QUERY_REPO_URL:-ssh://git@github.com/example-org/xyne-query-python.git}"
TEMP_DIR="${TEMP_DIR:-/tmp/xyne-query-python-$$}"
BUMP_TYPE="${1:-patch}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --bump)
            BUMP_TYPE="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    log_error "Invalid bump type: $BUMP_TYPE. Must be patch, minor, or major."
fi

log_info "Starting Python client publish process..."
log_info "Bump type: $BUMP_TYPE"

# Step 1: Install backend dependencies and generate DMMF
log_info "Step 1: Installing dependencies and generating DMMF..."
cd "$BACKEND_DIR"
npm ci --prefer-offline
npx tsx scripts/extract-dmmf.ts

# Step 2: Clone the repo
log_info "Step 2: Cloning xyne-query-python repo..."
rm -rf "$TEMP_DIR"
git clone "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"

# Step 3: Read current version and bump
log_info "Step 3: Bumping version..."
if [[ -f VERSION ]]; then
    CURRENT_VERSION=$(cat VERSION | tr -d '\n')
else
    CURRENT_VERSION="0.0.0"
fi

# Parse version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case $BUMP_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
log_info "Version: $CURRENT_VERSION -> $NEW_VERSION"

# Step 4: Generate new Python client
log_info "Step 4: Generating Python client..."
cd "$BACKEND_DIR"
npx tsx scripts/generate-python-client.ts \
    --output-dir "$TEMP_DIR" \
    --version "$NEW_VERSION"

# Step 5: Commit and push
log_info "Step 5: Committing and pushing..."
cd "$TEMP_DIR"

git add -A

# Check if there are changes
if git diff --staged --quiet; then
    log_warn "No changes detected. Skipping commit."
else
    git commit -m "chore: Auto-generated Python client v${NEW_VERSION}

Generated from schema.prisma at $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Commit: ${GIT_COMMIT:-$(cd "$BACKEND_DIR" && git rev-parse --short HEAD)}"

    git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
    
    git push origin main
    git push origin "v${NEW_VERSION}"
    
    log_info "✅ Successfully published xyne-query v${NEW_VERSION}"
fi

# Cleanup
rm -rf "$TEMP_DIR"

log_info "Done!"
