#!/bin/bash
# Collect container logs from the test docker stack into per-service files.
#
# Usage:
#   ./collect-ci-artifacts.sh <output-dir> [<compose-project-name>]
#
# Args:
#   <output-dir>             Directory to write {service}.log files into. Created if missing.
#   <compose-project-name>   Optional. Scopes `docker compose` to a specific project so logs
#                            from concurrent CI runs don't bleed in.
#
# Reads compose files from the current working directory (expects to be invoked from the
# monorepo root containing docker-compose.dev.yml and docker-compose.test.yml).
set -e

OUTPUT_DIR="${1:-xyne-automation/reports/docker-logs}"
COMPOSE_PROJECT_NAME="${2:-}"

COMPOSE_ARGS="-f docker-compose.dev.yml -f docker-compose.test.yml"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
  COMPOSE_ARGS="$COMPOSE_ARGS -p $COMPOSE_PROJECT_NAME"
fi

mkdir -p "$OUTPUT_DIR"

# Keep this list in sync with the services defined under docker-compose.{dev,test}.yml.
SERVICES=(
  postgres
  common-postgres
  backend-migrate
  claw-auth-postgres
  redis
  livekit
  fake-gcs
  zero-cache
  ysweet
  superposition
  backend
  dashboard
  xyne-automation
  transcription-agent
)

echo "=== Collecting container logs into $OUTPUT_DIR ==="
for service in "${SERVICES[@]}"; do
  # Suppress errors (service may be disabled via compose profile) and skip empty logs.
  LOG_OUTPUT=$(docker compose $COMPOSE_ARGS logs --no-color "$service" 2>/dev/null || true)
  if [ -n "$(printf '%s' "$LOG_OUTPUT" | tr -d '[:space:]')" ]; then
    printf '%s' "$LOG_OUTPUT" > "$OUTPUT_DIR/${service}.log"
  fi
done

echo "Done."
