#!/usr/bin/env bash
# The full capacity sweep of the sync server: how many subscriptions it holds,
# how fast it registers them, and how many updates a second it carries to them —
# native, and pinned to each CPU budget in CPUS.
#
# Two sweeps per target:
#   capacity   – CAP_CONNECTIONS clients, each registering the chat screen's
#                query set, at a trickle of writes: the subscriptions held, the
#                registrations a second, and the hydration latency.
#   throughput – CONNECTIONS clients while the write rate climbs through RATES:
#                the updates a second the server carries, and the delivery
#                latency at each step. Writes go straight into PostgreSQL
#                (--writes sql), so the number is this server's own pipeline,
#                with no application server in the path.
#
# The pinned runs put the server in a container with `--cpus N` on the host
# network, so it reaches the same PostgreSQL and application server as the
# native one; the native server is stopped while they run, so only one engine
# is following the feed. Every server runs with a short client-group grace
# period (GROUP_TTL_MS) and every run waits it out, so one run's subscriptions
# are released before the next starts and no run inherits the last one's
# fan-out.
#
#   LINUX_BIN=/path/to/linux/server CPUS="2 4 8" scripts/load-sweep.sh
#
# Environment: LINUX_BIN (required for the pinned runs), CPUS ("2 4 8"),
# NATIVE (1 to include a native run, default 1), NATIVE_BIN, PORT (4849),
# CAP_CONNECTIONS ("200 400 800"), CONNECTIONS (200), RATES ("50 100 200 400"),
# CHANNELS (1; more spreads the subscribers and the writes over that many
# channels, so each update reaches CONNECTIONS/CHANNELS subscribers and the
# ladder measures transactions a second rather than fan-out), GROUP_THREADS (1),
# TPS (20; the steady phase's transactions a second, so a rate of R puts R/TPS
# rows in each), CAP_SECONDS (12), SECONDS_PER_RATE (20), USERS, WRITERS, THREADS, PG_DSN,
# QUERY_URL, MUTATE_URL, E2E_WS, OUT_DIR (results/sweep).
set -euo pipefail
cd "$(dirname "$0")/.."

CPUS=${CPUS:-"2 4 8"}
NATIVE=${NATIVE:-1}
NATIVE_BIN=${NATIVE_BIN:-./target/release/server}
PORT=${PORT:-4849}
OUT_DIR=${OUT_DIR:-results/sweep}
CAP_CONNECTIONS=${CAP_CONNECTIONS:-"200 400 800"}
CONNECTIONS=${CONNECTIONS:-200}
RATES=${RATES:-"50 100 200 400"}
CHANNELS=${CHANNELS:-1}
GROUP_THREADS=${GROUP_THREADS:-1}
TPS=${TPS:-20}
CAP_SECONDS=${CAP_SECONDS:-12}
SECONDS_PER_RATE=${SECONDS_PER_RATE:-20}
USERS=${USERS:-10}
WRITERS=${WRITERS:-8}
THREADS=${THREADS:-3}
GROUP_TTL_MS=${GROUP_TTL_MS:-2000}
PG_DSN=${PG_DSN:-postgresql://postgres@127.0.0.1:5499/xyne_dev_db}
QUERY_URL=${QUERY_URL:-http://127.0.0.1:3001/api/sync/query}
MUTATE_URL=${MUTATE_URL:-http://127.0.0.1:3001/api/sync/push}
mkdir -p "$OUT_DIR"

# One load run against `ws`, tagged `label`, sampling `sampler` (a pid or a
# container name); everything after the first three arguments goes to the
# load script.
run() {
  local label=$1 ws=$2 sampler=$3
  shift 3
  local out="$OUT_DIR/$label.json"
  echo "-- $label"
  # shellcheck disable=SC2086
  node scripts/load-protocol.mjs --gateway "$ws" $sampler --label "$label" --out "$out" --quiet \
    --users "$USERS" --writers "$WRITERS" --threads "$THREADS" --channels "$CHANNELS" --tps "$TPS" "$@" 2>&1 |
    grep -E "hydrated|steady:|channel fan-out|dropped connections|server stages" || true
}

# Wait out the grace period, so the run just finished has released its
# subscriptions before the next one registers its own, and take that run's
# rows back out of the channel so every step starts from the same data.
settle() {
  sleep $(( GROUP_TTL_MS / 1000 + 2 ))
  psql "$PG_DSN" -q -c "DELETE FROM messages WHERE \"conversationId\" LIKE 'lcv-%'" \
    -c "DELETE FROM conversations WHERE \"conversationId\" LIKE 'lcv-%'" >/dev/null 2>&1 || true
  sleep 3
}

# Both sweeps against one target.
sweep() {
  local target=$1 ws=$2 sampler=$3
  for c in $CAP_CONNECTIONS; do
    run "$target-capacity-$c" "$ws" "$sampler" --connections "$c" --rate 5 --duration "$CAP_SECONDS" --writes sql
    settle
  done
  for r in $RATES; do
    run "$target-rate-$r" "$ws" "$sampler" --connections "$CONNECTIONS" --rate "$r" --duration "$SECONDS_PER_RATE" --writes sql
    settle
  done
}

native_pid() { pgrep -f "$NATIVE_BIN" | head -1; }

if [ "$NATIVE" = 1 ]; then
  pid=$(native_pid || true)
  [ -n "$pid" ] || { echo "no native server running at $NATIVE_BIN"; exit 2; }
  echo "== native server (pid $pid)"
  sweep native "ws://127.0.0.1:4848/sync" "--pid $pid"
fi

if [ -n "${LINUX_BIN:-}" ]; then
  stopped=$(native_pid || true)
  if [ -n "$stopped" ]; then
    echo "== stopping the native server while the pinned runs go"
    kill "$stopped"
    sleep 2
  fi
  for cpus in $CPUS; do
    docker rm -f xs-load >/dev/null 2>&1 || true
    docker run -d --name xs-load --network host --cpus "$cpus" -v "$LINUX_BIN:/server:ro" \
      -e STREAMGRES_ADDR=0.0.0.0:$PORT -e STREAMGRES_PUBLICATION=xyne_load_pub -e STREAMGRES_PG_DSN="$PG_DSN" \
      -e STREAMGRES_BASE_PATH=/sync -e STREAMGRES_APP_ID="${APP_ID:-xyne}" \
      -e STREAMGRES_QUERY_URL="$QUERY_URL" -e STREAMGRES_MUTATE_URL="$MUTATE_URL" -e STREAMGRES_LOG=info \
      -e STREAMGRES_GROUP_TTL_MS="$GROUP_TTL_MS" -e STREAMGRES_GROUP_THREADS="$GROUP_THREADS" \
      debian:bookworm-slim /server >/dev/null
    for _ in $(seq 1 240); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.25; done
    echo "== server pinned to $cpus cpu(s)"
    sweep "cpus$cpus" "ws://127.0.0.1:$PORT/sync" "--container xs-load"
    docker logs xs-load > "$OUT_DIR/server-cpus$cpus.log" 2>&1 || true
    docker rm -f xs-load >/dev/null 2>&1 || true
  done
  if [ -n "$stopped" ]; then
    echo "== restarting the native server"
    (nohup "$NATIVE_BIN" >> "${SERVER_LOG:-/dev/null}" 2>&1 &)
  fi
fi
echo "== done; results in $OUT_DIR"
