#!/usr/bin/env bash
#
# deploy-dev.sh — One-shot local dev Vespa deployment
#
# Does everything needed for a first-time or re-deployment:
#   1. Checks prerequisites (docker/podman + curl; the vespa CLI is optional)
#   2. Creates vespa-data with correct ownership
#   3. Starts Vespa container via docker-compose.dev.yml
#   4. Waits for Vespa to be healthy
#   5. Downloads embedding models if missing
#   6. Builds application package
#   7. Replaces v[DIMS] placeholders
#   8. Deploys schemas to localhost:19071
#
# Usage:
#   ./deploy-dev.sh
#   EMBEDDING_MODEL=bge-base-en-v1.5 ./deploy-dev.sh
#   VESPA_DEPLOY_MODE=http ./deploy-dev.sh   # ignore the vespa CLI even if present
#
# Callable from scripts/start-services.sh, which injects the container runtime it
# already detected:
#   DOCKER_COMPOSE="podman compose" CONTAINER_CLI=podman ./deploy-dev.sh
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENT_DIR="$REPO_ROOT/deployment"
VESPA_ROOT="$REPO_ROOT/vespa"
MODELS="$VESPA_ROOT/models"
BUILD_DIR="$REPO_ROOT/generated/vespa/application-package"
VESPA_TARGET="http://localhost:19071"

EMBEDDING_MODEL="${EMBEDDING_MODEL:-bge-small-en-v1.5}"

# Container runtime. Both are overridable so a parent script (npm run services)
# can pass down the runtime it already detected instead of re-detecting docker.
DOCKER_COMPOSE="${DOCKER_COMPOSE:-}"
CONTAINER_CLI="${CONTAINER_CLI:-}"

# Compose project name. Without this, compose derives it from this file's parent
# directory and Vespa ends up in a project called "deployment", separate from the
# rest of the stack. Pin it to the monorepo directory name — the same value the
# root docker-compose.dev.yml resolves to — so every container is grouped together.
MONOREPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$MONOREPO_ROOT")}"
# Project names must be lowercase alphanumeric / underscore / hyphen.
COMPOSE_PROJECT="$(echo "$COMPOSE_PROJECT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | sed 's/-*$//')"

# How to talk to the config server: "cli" uses the vespa CLI when installed,
# "http" always posts the package with curl. Default picks whatever is available.
VESPA_DEPLOY_MODE="${VESPA_DEPLOY_MODE:-auto}"

# --- Colors ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
log_ok()    { echo -e "${GREEN}✓${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
log_error() { echo -e "${RED}✗${NC}  $*"; }

# --- Prerequisites ---
check_prereqs() {
  log_info "Checking prerequisites..."

  # Runtime CLI: use what was injected, else prefer docker, else podman.
  if [ -z "$CONTAINER_CLI" ]; then
    if command -v docker >/dev/null 2>&1; then
      CONTAINER_CLI="docker"
    elif command -v podman >/dev/null 2>&1; then
      CONTAINER_CLI="podman"
    else
      log_error "docker or podman is required"
      exit 1
    fi
  fi

  if [ -z "$DOCKER_COMPOSE" ]; then
    if $CONTAINER_CLI compose version >/dev/null 2>&1; then
      DOCKER_COMPOSE="$CONTAINER_CLI compose"
    elif command -v "${CONTAINER_CLI}-compose" >/dev/null 2>&1; then
      DOCKER_COMPOSE="${CONTAINER_CLI}-compose"
    else
      log_error "$CONTAINER_CLI compose (or ${CONTAINER_CLI}-compose) is required"
      exit 1
    fi
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log_error "curl is required"
    exit 1
  fi

  # The vespa CLI is optional: with it we get its nicer wait/validation output,
  # without it we POST the application package to the config server ourselves.
  if command -v vespa >/dev/null 2>&1 && [ "$VESPA_DEPLOY_MODE" != "http" ]; then
    DEPLOY_MODE="cli"
  else
    DEPLOY_MODE="http"
    # Zipping the package: zip(1) if available, else python3's zipfile module.
    if command -v zip >/dev/null 2>&1; then
      ZIP_TOOL="zip"
    elif command -v python3 >/dev/null 2>&1; then
      ZIP_TOOL="python3"
    else
      log_error "the HTTP deploy path needs either zip or python3"
      log_error "(or install the vespa CLI: https://docs.vespa.ai/en/vespa-cli.html)"
      exit 1
    fi
  fi

  log_ok "All prerequisites found (deploy mode: $DEPLOY_MODE)"
}

# --- Resolve DIMS from EMBEDDING_MODEL ---
resolve_dims() {
  case "$EMBEDDING_MODEL" in
    bge-small-en-v1.5)
      DIMS=384
      TOKENIZER_URL="https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer.json"
      MODEL_URL="https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx"
      ;;
    bge-base-en-v1.5)
      DIMS=768
      TOKENIZER_URL="https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/tokenizer.json"
      MODEL_URL="https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/onnx/model.onnx"
      ;;
    bge-large-en-v1.5)
      DIMS=1024
      TOKENIZER_URL="https://huggingface.co/BAAI/bge-large-en-v1.5/resolve/main/tokenizer.json"
      MODEL_URL="https://huggingface.co/BAAI/bge-large-en-v1.5/resolve/main/onnx/model.onnx"
      ;;
    *)
      log_error "Unknown EMBEDDING_MODEL '$EMBEDDING_MODEL'. Use one of: bge-small-en-v1.5, bge-base-en-v1.5, bge-large-en-v1.5"
      exit 1
      ;;
  esac
  log_info "Using embedding model: $EMBEDDING_MODEL (dims=$DIMS)"
}

# --- Setup data directories ---
setup_dirs() {
  log_info "Setting up data directories..."

  # docker-compose.dev.yml is run from deployment/, so ./vespa-data resolves
  # to deployment/vespa-data — that's the ACTUAL data dir the container uses.
  local data_dir
  data_dir="$DEPLOYMENT_DIR/vespa-data"

  mkdir -p "$data_dir"

  # If the current user IS uid 1000, mkdir already created with the right owner.
  # Otherwise, use the Docker daemon (which runs as root) to fix ownership.
  # This avoids needing sudo on the host.
  local current_uid
  current_uid=$(id -u)

  if [ "$current_uid" -eq 1000 ]; then
    log_ok "Running as uid 1000 — no ownership fix needed"
  else
    # Check if already correct
    local dir_uid dir_gid
    dir_uid=$(stat -c %u "$data_dir" 2>/dev/null || echo "-1")
    dir_gid=$(stat -c %g "$data_dir" 2>/dev/null || echo "-1")

    if [ "$dir_uid" = "1000" ] && [ "$dir_gid" = "1000" ]; then
      log_ok "vespa-data already owned by 1000:1000"
    else
      log_info "Fixing ownership via the container runtime (uid 1000:1000)..."
      if $CONTAINER_CLI run --rm -v "$data_dir:/data" busybox chown -R 1000:1000 /data 2>/dev/null; then
        log_ok "Ownership fixed via $CONTAINER_CLI"
      else
        log_warn "Could not fix ownership automatically."
        log_warn "If Vespa fails to start, run this manually:"
        log_warn "  chown -R 1000:1000 $data_dir"
      fi
    fi
  fi

  chmod -R 755 "$data_dir" 2>/dev/null || true

  log_ok "Data directories ready"
}

# --- Start Vespa container ---
start_vespa() {
  log_info "Starting Vespa container (compose project: $COMPOSE_PROJECT)..."
  (
    cd "$DEPLOYMENT_DIR"
    $DOCKER_COMPOSE -p "$COMPOSE_PROJECT" -f docker-compose.dev.yml up -d
  )
  log_ok "Vespa container started"
}

# --- Wait for Vespa to be healthy ---
wait_for_vespa() {
  log_info "Waiting for Vespa to be ready..."

  local max_attempts=60
  local attempt=0

  while (( attempt++ < max_attempts )); do
    if curl -sf "$VESPA_TARGET/state/v1/health" >/dev/null 2>&1; then
      log_ok "Vespa is healthy"
      return 0
    fi
    echo -n "."
    sleep 2
  done

  log_error "Vespa did not become healthy after $((max_attempts * 2))s"
  log_info "Check logs: docker logs vespa"
  exit 1
}

# --- Download embedding models ---
download_models() {
  log_info "Checking embedding models..."

  mkdir -p "$MODELS"
  TOKENIZER_FILE="$MODELS/tokenizer.json"
  MODEL_FILE="$MODELS/model.onnx"
  MODEL_MARKER="$MODELS/.embedding-model"

  local cached_model=""
  [ -f "$MODEL_MARKER" ] && cached_model="$(cat "$MODEL_MARKER")"

  if [ -n "$cached_model" ] && [ "$cached_model" != "$EMBEDDING_MODEL" ]; then
    log_warn "Cached model ($cached_model) differs from requested ($EMBEDDING_MODEL); clearing models/"
    rm -f "$TOKENIZER_FILE" "$MODEL_FILE" "$MODEL_MARKER"
  fi

  if [ -f "$TOKENIZER_FILE" ]; then
    log_ok "Tokenizer already exists"
  else
    log_info "Downloading tokenizer..."
    curl -fsSL -o "$TOKENIZER_FILE" "$TOKENIZER_URL"
    log_ok "Tokenizer downloaded"
  fi

  if [ -f "$MODEL_FILE" ]; then
    log_ok "ONNX model already exists"
  else
    log_info "Downloading ONNX model (~130MB)..."
    curl -fsSL -o "$MODEL_FILE" "$MODEL_URL"
    log_ok "ONNX model downloaded"
  fi

  echo "$EMBEDDING_MODEL" > "$MODEL_MARKER"
}

# --- Build application package ---
build_package() {
  log_info "Building application package..."

  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"

  cp -R "$VESPA_ROOT/common/." "$BUILD_DIR/"
  cp "$VESPA_ROOT/docker/services.xml" "$BUILD_DIR/"
  cp -R "$MODELS" "$BUILD_DIR/models"

  # Stamp the embedding dimension into every tensor field: v[DIMS] -> v[384].
  # Plain sed, so this needs no JS runtime. Writing via a temp file keeps it
  # portable (GNU sed wants -i, BSD sed wants -i '').
  local stamped=0
  for schema in "$BUILD_DIR"/schemas/*.sd; do
    [ -e "$schema" ] || continue
    sed -E "s/v\[(DIMS|[0-9]+)\]/v[$DIMS]/g" "$schema" > "$schema.tmp" \
      && mv "$schema.tmp" "$schema"
    stamped=$((stamped + 1))
  done

  if [ "$stamped" -eq 0 ]; then
    log_error "No .sd files found in $BUILD_DIR/schemas"
    exit 1
  fi

  # Nothing should reference the placeholder after this point.
  if grep -rq "v\[DIMS\]" "$BUILD_DIR/schemas"; then
    log_error "v[DIMS] placeholders remain after substitution"
    exit 1
  fi

  log_ok "Application package built at $BUILD_DIR ($stamped schemas at $DIMS dims)"
}

# --- Deploy ---
deploy_schemas() {
  log_info "Deploying schemas to $VESPA_TARGET (mode: $DEPLOY_MODE)..."
  if [ "$DEPLOY_MODE" = "cli" ]; then
    vespa deploy --wait 960 --target "$VESPA_TARGET" "$BUILD_DIR"
    vespa status --wait 75 --target "$VESPA_TARGET"
  else
    deploy_over_http
  fi
  log_ok "Schemas deployed successfully"
}

# Same thing the vespa CLI does: zip the package and POST it to the config
# server's prepareandactivate endpoint, then wait for the services to converge.
deploy_over_http() {
  local zip_path="$REPO_ROOT/generated/vespa/application.zip"
  rm -f "$zip_path"
  mkdir -p "$(dirname "$zip_path")"

  if [ "$ZIP_TOOL" = "zip" ]; then
    (cd "$BUILD_DIR" && zip -qr "$zip_path" .)
  else
    python3 - "$zip_path" "$BUILD_DIR" <<'PY'
import os, sys, zipfile
zip_path, root = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, root))
PY
  fi
  log_info "Package zipped ($(du -h "$zip_path" | cut -f1)), uploading..."

  local response
  response=$(curl -sS --max-time 960 \
    --header "Content-Type: application/zip" \
    --data-binary @"$zip_path" \
    "$VESPA_TARGET/application/v2/tenant/default/prepareandactivate")

  # Failures come back as {"error-code":"...","message":"..."}
  if echo "$response" | grep -q '"error-code"'; then
    log_error "Deploy rejected by the config server:"
    echo "$response" | tr ',' '\n' | grep -E '"(error-code|message)"' | sed 's/^/    /'
    exit 1
  fi
  log_ok "Application package activated"

  wait_for_convergence
}

# The config server reports whether every service has picked up the new
# generation — this is what `vespa status --wait` polls for.
wait_for_convergence() {
  local url="$VESPA_TARGET/application/v2/tenant/default/application/default"
  url="$url/environment/prod/region/default/instance/default/serviceconverge"

  log_info "Waiting for services to converge..."
  local attempt=0
  while (( attempt++ < 120 )); do
    if curl -sf "$url" 2>/dev/null | grep -q '"converged":true'; then
      log_ok "All services converged"
      return 0
    fi
    echo -n "."
    sleep 5
  done

  echo ""
  log_warn "Services did not report converged within 600s."
  log_warn "The package was activated; check: docker logs vespa"
  return 0
}

# --- Main ---
main() {
  log_info "=== Vespa Local Dev Deployment ==="
  echo ""

  check_prereqs
  resolve_dims
  setup_dirs
  start_vespa
  wait_for_vespa
  download_models
  build_package
  deploy_schemas

  echo ""
  log_ok "Done! Vespa is ready."
  log_info "  Feed:    http://localhost:${VESPA_FEED_PORT:-8083}   (set VESPA_FEED_URL to this)"
  log_info "  Query:   http://localhost:${VESPA_QUERY_PORT:-8081}"
  log_info "  Admin:   http://localhost:19071"
}

main "$@"
