#!/usr/bin/env bash
# Run the cucumber automation suite (xyne-automation-old) locally against the
# same docker-compose stack Jenkins uses. Mirrors what Jenkins runs when
# USE_CUCUMBER=true (gauge is now the default in CI). Pull the cucumber HTML
# report out of the container at the end so you can open it on the host.
#
# Usage:
#   scripts/run-cucumber-local.sh [profile]
#
# profile (optional):
#   all  (default) - npm run test
#   ui             - npm run test:ui
#   api            - npm run test:api
#   e2e            - npm run test:e2e
#   fe             - npm run test:ui && npm run test:e2e   (matches Jenkins for */fe/* branches)
#   be             - npm run test:api && npm run test:e2e  (matches Jenkins for */be/* branches)
#
# Env knobs:
#   KEEP_UP=1  - skip teardown (leave containers running for re-runs / debugging)

set -euo pipefail

PROFILE="${1:-all}"
case "$PROFILE" in
  all) TEST_CMD='npm run test' ;;
  ui)  TEST_CMD='npm run test:ui' ;;
  api) TEST_CMD='npm run test:api' ;;
  e2e) TEST_CMD='npm run test:e2e' ;;
  fe)  TEST_CMD='npm run test:ui && npm run test:e2e' ;;
  be)  TEST_CMD='npm run test:api && npm run test:e2e' ;;
  *)
    echo "Unknown profile: $PROFILE" >&2
    echo "Use one of: all | ui | api | e2e | fe | be" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose --profile cucumber -f docker-compose.dev.yml -f docker-compose.test.yml)

# Bind every host port to 0 so this run doesn't collide with a dev stack.
export POSTGRES_BIND_PORT=0
export REDIS_BIND_PORT=0
export LIVEKIT_HTTP_BIND_PORT=0
export LIVEKIT_HTTPS_BIND_PORT=0
export LIVEKIT_UDP_BIND_PORT=0
export FAKE_GCS_BIND_PORT=0
export MINIO_API_BIND_PORT=0
export MINIO_CONSOLE_BIND_PORT=0
export ZERO_BIND_PORT_1=0
export ZERO_BIND_PORT_2=0
export TRANSCRIPTION_AGENT_BIND_PORT=0
export SUPERPOSITION_BIND_PORT=0
export BACKEND_BIND_PORT=0
export DASHBOARD_BIND_PORT=0
export YSWEET_BIND_PORT=0
export CLAW_AUTH_POSTGRES_BIND_PORT=0
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-xyne-test-local-cucumber}"

cleanup() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    echo ">>> KEEP_UP=1, leaving stack running. Stop with: ${COMPOSE[*]} down -v --remove-orphans"
    return
  fi
  echo ">>> Tearing down stack"
  "${COMPOSE[@]}" down -v --remove-orphans || true
}
trap cleanup EXIT

echo ">>> Cleaning previous report artifacts"
rm -rf xyne-automation-old/report/* || true

echo ">>> Building backend, dashboard, xyne-automation-old"
"${COMPOSE[@]}" build backend dashboard xyne-automation-old

echo ">>> Bringing services up (waiting for health)"
"${COMPOSE[@]}" up -d --wait

echo ">>> Running cucumber tests: ${TEST_CMD}"
set +e
"${COMPOSE[@]}" exec -T xyne-automation-old sh -c "${TEST_CMD}"
TEST_STATUS=$?
set -e

echo ">>> Pulling cucumber report out of container"
mkdir -p xyne-automation-old/report
CONTAINER_ID="$("${COMPOSE[@]}" ps -q xyne-automation-old)"
if [[ -n "$CONTAINER_ID" ]]; then
  docker cp "$CONTAINER_ID":/app/report/. xyne-automation-old/report/ || true
fi

LATEST_REPORT="$(ls -dt xyne-automation-old/report/*/ 2>/dev/null | head -1 || true)"
if [[ -n "$LATEST_REPORT" ]]; then
  echo ">>> Cucumber HTML report: ${LATEST_REPORT}cucumber-report.html"
else
  echo ">>> No report directory found (test may have crashed before writing one)"
fi

if [[ "$TEST_STATUS" -eq 0 ]]; then
  echo ">>> Cucumber tests passed."
else
  echo ">>> Cucumber tests failed (exit ${TEST_STATUS})." >&2
fi
exit "$TEST_STATUS"
