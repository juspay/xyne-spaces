#!/bin/bash
# Headed-mode test runner. Spins up the Docker test stack (backend + dashboard +
# infra) WITHOUT the automation container, then runs gauge on the host with
# HEADLESS=false so the Playwright browser opens visibly on the Mac screen.
#
# Why this shape:
#  - The automation container has no display, so headed mode isn't possible there.
#  - The dashboard container's vite preview proxies `/api/*` to backend:3001 over
#    the compose network, so a host-side browser only needs the dashboard's
#    exposed port — the backend's internal hostname never leaks to the browser.
#
# Usage: run-headed.sh [targets...]
#   e.g. run-headed.sh tests/03_e2e/05_messaging/04_message-actions.spec
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$AUTOMATION_DIR/../.." && pwd)"
PROJECT_NAME="xyne-test-headed-$$"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("tests/03_e2e")
fi

cd "$PROJECT_ROOT"

# --- Allocate random host ports (same vars the runner's ports.ts manages). ---
# One port per bind var; a tiny Node snippet asks the kernel for free ports.
PORT_VARS=(
  POSTGRES_BIND_PORT COMMON_POSTGRES_BIND_PORT REDIS_BIND_PORT
  LIVEKIT_HTTP_BIND_PORT LIVEKIT_HTTPS_BIND_PORT LIVEKIT_UDP_BIND_PORT
  FAKE_GCS_BIND_PORT MINIO_API_BIND_PORT MINIO_CONSOLE_BIND_PORT
  ZERO_BIND_PORT_1 ZERO_BIND_PORT_2 TRANSCRIPTION_AGENT_BIND_PORT
  YSWEET_BIND_PORT SUPERPOSITION_BIND_PORT CLAW_AUTH_POSTGRES_BIND_PORT
  OTEL_HTTP_BIND_PORT OTEL_GRPC_BIND_PORT OTEL_METRICS_BIND_PORT
  VICTORIAMETRICS_BIND_PORT VICTORIALOGS_ERRORS_BIND_PORT
  FLUENT_BIT_HTTP_BIND_PORT FLUENT_BIT_FORWARD_BIND_PORT
  GRAFANA_BIND_PORT BACKEND_BIND_PORT DASHBOARD_BIND_PORT
)

echo "→ allocating host ports…"
# Spawn N listening sockets on port 0, record what the kernel assigned, close them.
# Keeping them open simultaneously guarantees distinct ports.
PORTS_RAW=$(node -e '
  const net = require("node:net");
  const n = parseInt(process.argv[1], 10);
  (async () => {
    const servers = [];
    const ports = [];
    for (let i = 0; i < n; i++) {
      await new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => {
          ports.push(s.address().port);
          servers.push(s);
          resolve();
        });
        s.on("error", reject);
      });
    }
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
    process.stdout.write(ports.join(" "));
  })().catch((e) => { console.error(e); process.exit(1); });
' "${#PORT_VARS[@]}")
read -r -a PORTS <<<"$PORTS_RAW"

for i in "${!PORT_VARS[@]}"; do
  export "${PORT_VARS[$i]}=${PORTS[$i]}"
done

# --- Patch the dashboard build so API traffic stays same-origin. ---
# The committed test bundle hard-codes `API_BASE_URL=http://localhost:3001/api`
# whenever the browser is on localhost (apps/dashboard/src/config.ts:34), which
# would force BACKEND_BIND_PORT=3001 (collisions, no parallel runs). Writing
# `.env.test.local` with `VITE_API_BASE_OVERRIDE=/api` makes the bundle use the
# same-origin path, which vite preview proxies back to backend:3001 over the
# compose network — so backend can keep its random host port.
DASHBOARD_ENV_LOCAL="$PROJECT_ROOT/apps/dashboard/.env.test.local"
echo "VITE_API_BASE_OVERRIDE=/api" > "$DASHBOARD_ENV_LOCAL"

# --- Bring up the Docker stack (no --profile gauge → automation container stays out). ---
echo "→ building & starting Docker stack as project '$PROJECT_NAME' (first run rebuilds dashboard)…"
cleanup() {
  echo "→ tearing down Docker stack…"
  rm -f "$DASHBOARD_ENV_LOCAL"
  docker compose \
    -f docker-compose.dev.yml -f docker-compose.test.yml \
    -p "$PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose \
  -f docker-compose.dev.yml -f docker-compose.test.yml \
  -p "$PROJECT_NAME" \
  up -d --wait --build backend dashboard ysweet zero-cache livekit fake-gcs

# --- Discover each service's host-exposed port. ---
# The dashboard surfaces absolute container URLs (ysweet, livekit, etc.) that a
# host-side browser can't resolve. Chromium's --host-resolver-rules remaps the
# internal container:port pairs to localhost:host_port, so no backend-side URL
# rewriting is needed. See browser-manager.ts for how the env is consumed.
port_of() {
  docker compose -p "$PROJECT_NAME" port "$1" "$2" 2>/dev/null | cut -d: -f2
}

DASHBOARD_HOST_PORT=$(port_of dashboard 5173)
BACKEND_HOST_PORT=$(port_of backend 3001)
YSWEET_HOST_PORT=$(port_of ysweet 8080)
ZERO_HOST_PORT=$(port_of zero-cache 4848)
LIVEKIT_HOST_PORT=$(port_of livekit 7880)
FAKE_GCS_HOST_PORT=$(port_of fake-gcs 4443)

RULES=""
add_rule() {
  local hostport="$1"
  local target="$2"
  [ -z "$target" ] && return
  [ -n "$RULES" ] && RULES="$RULES, "
  RULES="${RULES}MAP $hostport 127.0.0.1:$target"
}
add_rule backend:3001       "$BACKEND_HOST_PORT"
add_rule dashboard:5173     "$DASHBOARD_HOST_PORT"
add_rule ysweet:8080        "$YSWEET_HOST_PORT"
add_rule zero-cache:4848    "$ZERO_HOST_PORT"
add_rule livekit:7880       "$LIVEKIT_HOST_PORT"
add_rule fake-gcs:4443      "$FAKE_GCS_HOST_PORT"

echo "→ dashboard: http://localhost:$DASHBOARD_HOST_PORT  backend: http://localhost:$BACKEND_HOST_PORT"
echo "→ host-resolver-rules: $RULES"
echo "→ running gauge headed (browser will open on your screen)…"

cd "$AUTOMATION_DIR"
export TEST_ENV=local
export HEADLESS=false
export BACKEND_URL="http://localhost:$BACKEND_HOST_PORT"
export DASHBOARD_URL="http://localhost:$DASHBOARD_HOST_PORT"
export BROWSER_HOST_RESOLVER_RULES="$RULES"
# `pnpm exec ts-node` so we reuse the automation deps that are already installed.
pnpm exec ts-node --project tsconfig.json scripts/run-gauge.ts "${TARGETS[@]}"
