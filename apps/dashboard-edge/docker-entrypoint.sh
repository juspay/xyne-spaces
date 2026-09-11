#!/bin/sh
# Render nginx.conf from the template, start the edge app (Node) on loopback,
# then run nginx in the foreground.
set -eu

export LOG_LEVEL="${LOG_LEVEL:-info}"
export CACHE_MAX_SIZE="${CACHE_MAX_SIZE:-2g}"
export CACHE_INACTIVE="${CACHE_INACTIVE:-7d}"
export CACHE_TTL="${CACHE_TTL:-30d}"
export EDGE_APP_ADDR="${EDGE_APP_ADDR:-127.0.0.1}"
export EDGE_APP_PORT="${EDGE_APP_PORT:-9101}"
export EDGE_SYSLOG_PORT="${EDGE_SYSLOG_PORT:-9102}"

mkdir -p /var/run/edge /var/cache/edge
envsubst '${LOG_LEVEL} ${CACHE_MAX_SIZE} ${CACHE_INACTIVE} ${EDGE_APP_PORT} ${EDGE_SYSLOG_PORT}' \
  < /opt/edge/nginx.conf.template > /var/run/edge/nginx.conf
envsubst '${CACHE_TTL}' < /opt/edge/proxy-origin.conf.template > /var/run/edge/proxy-origin.conf

# The edge app owns rules, storage access and status. Restarted if it ever
# exits; nginx keeps serving cached objects meanwhile.
(
  set +e # the loop must survive a non-zero exit from the app
  while :; do
    node /opt/edge/app/dist/main.js
    echo "edge app exited with $?, restarting in 1s" >&2
    sleep 1
  done
) &

i=0
until curl -sf "http://${EDGE_APP_ADDR}:${EDGE_APP_PORT}/_edge/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 100 ] && { echo "edge app did not become healthy" >&2; break; }
  sleep 0.2
done

exec nginx -c /var/run/edge/nginx.conf -g 'daemon off;'
