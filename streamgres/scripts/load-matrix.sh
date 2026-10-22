#!/usr/bin/env bash
# Run the load test against the server pinned to different CPU budgets.
#
# The server runs as a Linux binary in a container with `--cpus N` (CFS quota) on
# the host network, so it reaches the same Postgres and backend as the native one.
# One run per value in CPUS; the native server (PID in NATIVE_PID, port 4848) is
# measured first when NATIVE=1. Results land in results/load-<label>.json plus the
# server log of each run.
#
#   LINUX_BIN=/path/to/linux/server CPUS="2 4 8" CONNECTIONS=200 RATE=50 DURATION=60 \
#     scripts/load-matrix.sh
#
# Environment: LINUX_BIN (required for the container runs), CPUS (default "2 4 8"),
# NATIVE (1 to include the native run), NATIVE_PID, PORT (4849), CONNECTIONS, USERS,
# WRITERS, SEED, SEED_REPLIES (only applied to the first run), THREADS, RATE,
# DURATION, REPLY_SHARE, PG_DSN, QUERY_URL, MUTATE_URL, E2E_WS, OUT_DIR (results).
set -euo pipefail
cd "$(dirname "$0")/.."
CPUS=${CPUS:-"2 4 8"}
PORT=${PORT:-4849}
OUT_DIR=${OUT_DIR:-results}
CONNECTIONS=${CONNECTIONS:-100}
USERS=${USERS:-10}
WRITERS=${WRITERS:-4}
SEED=${SEED:-0}
SEED_REPLIES=${SEED_REPLIES:-0}
THREADS=${THREADS:-3}
RATE=${RATE:-20}
DURATION=${DURATION:-30}
REPLY_SHARE=${REPLY_SHARE:-0.3}
PG_DSN=${PG_DSN:-postgresql://postgres@127.0.0.1:5499/xyne_dev_db}
QUERY_URL=${QUERY_URL:-http://127.0.0.1:3001/api/sync/query}
MUTATE_URL=${MUTATE_URL:-http://127.0.0.1:3001/api/sync/push}
mkdir -p "$OUT_DIR"
seed_args="--seed $SEED --seed-replies $SEED_REPLIES"
common() { echo --connections "$CONNECTIONS" --users "$USERS" --writers "$WRITERS" --threads "$THREADS" --rate "$RATE" --duration "$DURATION" --reply-share "$REPLY_SHARE"; }
if [ "${NATIVE:-0}" = 1 ]; then
  pid=${NATIVE_PID:-$(pgrep -f target/release/server | head -1)}
  echo "== native server (pid $pid)"
  # shellcheck disable=SC2046
  node scripts/load-protocol.mjs $(common) $seed_args --pid "$pid" --label native --out "$OUT_DIR/load-native.json" --quiet
  seed_args="--seed 0 --seed-replies 0"
fi
for cpus in $CPUS; do
  [ -n "${LINUX_BIN:-}" ] || { echo "LINUX_BIN is required for the container runs"; exit 2; }
  docker rm -f xs-load >/dev/null 2>&1 || true
  docker run -d --name xs-load --network host --cpus "$cpus" -v "$LINUX_BIN:/server:ro" \
    -e STREAMGRES_ADDR=0.0.0.0:$PORT -e STREAMGRES_PUBLICATION=xyne_load_pub -e STREAMGRES_PG_DSN="$PG_DSN" \
    -e STREAMGRES_BASE_PATH=/sync -e STREAMGRES_APP_ID="${APP_ID:-xyne}" \
    -e STREAMGRES_QUERY_URL="$QUERY_URL" -e STREAMGRES_MUTATE_URL="$MUTATE_URL" -e STREAMGRES_LOG=info \
    debian:bookworm-slim /server >/dev/null
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.2; done
  echo "== server pinned to $cpus cpu(s)"
  # shellcheck disable=SC2046
  node scripts/load-protocol.mjs $(common) $seed_args --gateway "ws://127.0.0.1:$PORT/sync" --container xs-load --label "cpus=$cpus" --out "$OUT_DIR/load-cpus$cpus.json" --quiet || true
  seed_args="--seed 0 --seed-replies 0"
  docker logs xs-load > "$OUT_DIR/server-cpus$cpus.log" 2>&1 || true
  docker rm -f xs-load >/dev/null 2>&1 || true
done
echo "== done; results in $OUT_DIR"
