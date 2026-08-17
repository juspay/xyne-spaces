#!/bin/sh
set -e


ZERO_PID=""
NGINX_PID=""

term() {
  [ -n "$ZERO_PID" ] && kill -TERM "$ZERO_PID" 2>/dev/null || true
  [ -n "$NGINX_PID" ] && kill -TERM "$NGINX_PID" 2>/dev/null || true
  wait
  exit 0
}
trap term TERM INT

echo "Starting zero-cache..."
zero-cache &
ZERO_PID=$!

echo "Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

while kill -0 "$ZERO_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done

if kill -0 "$ZERO_PID" 2>/dev/null; then
  DEAD=nginx
  wait "$NGINX_PID" 2>/dev/null || STATUS=$?
else
  DEAD=zero-cache
  wait "$ZERO_PID" 2>/dev/null || STATUS=$?
fi
STATUS=${STATUS:-1}

echo "$DEAD exited with status $STATUS - shutting down container" >&2

kill -TERM "$ZERO_PID" "$NGINX_PID" 2>/dev/null || true
wait 2>/dev/null || true
exit "$STATUS"
