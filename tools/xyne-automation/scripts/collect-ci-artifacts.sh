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

# Compose files live at the monorepo root, three levels above this script; don't depend on cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_ARGS="-f $REPO_ROOT/docker-compose.dev.yml -f $REPO_ROOT/docker-compose.test.yml"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
  COMPOSE_ARGS="$COMPOSE_ARGS -p $COMPOSE_PROJECT_NAME"
fi

mkdir -p "$OUTPUT_DIR"

# Keep this list in sync with the services defined under docker-compose.{dev,test}.yml.
SERVICES=(
  postgres
  backend-migrate
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
STATES_FILE="$OUTPUT_DIR/container-states.txt"
: > "$STATES_FILE"
for service in "${SERVICES[@]}"; do
  container_name="${COMPOSE_PROJECT_NAME:-xyne}-${service}"
  STATE=$(docker inspect "$container_name" \
    --format 'Status={{.State.Status}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' \
    2>/dev/null || echo "container not found (never created, or already removed)")
  printf '%s: %s\n' "$service" "$STATE" >> "$STATES_FILE"
  # Last healthcheck probes (exit code + output) — the only place an "unhealthy" explains itself.
  docker inspect "$container_name" --format '{{if .State.Health}}{{range .State.Health.Log}}  probe exit={{.ExitCode}} {{.Output}}{{end}}{{end}}' \
    2>/dev/null | tail -n 3 >> "$STATES_FILE" || true

  # Suppress errors (service may be disabled via compose profile) and skip empty logs.
  LOG_OUTPUT=$(docker compose $COMPOSE_ARGS logs --no-color "$service" 2>/dev/null || true)
  if [ -n "$(printf '%s' "$LOG_OUTPUT" | tr -d '[:space:]')" ]; then
    printf '%s' "$LOG_OUTPUT" > "$OUTPUT_DIR/${service}.log"
  fi
done

echo "Done."
