#!/bin/bash
set -e

SSH_DIR=/home/nixuser/.ssh
WORKSPACE_ROOT=/home/nixuser/workspace
WORKSPACE_REPO_URL="${WORKSPACE_REPO_URL:-}"
WORKSPACE_REPO_REF="${WORKSPACE_REPO_REF:-main}"
WORKSPACE_SETUP_COMMAND="${WORKSPACE_SETUP_COMMAND:-}"
CDP_PORT=9222
CDP_EXTERNAL_PORT="${CDP_EXTERNAL_PORT:-9223}"
PREVIEW_VNC_PORT=5900
PREVIEW_HTTP_PORT="${PREVIEW_HTTP_PORT:-6080}"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-8443}"

mkdir -p "$SSH_DIR" "$WORKSPACE_ROOT"
chmod 700 "$SSH_DIR"
touch "$SSH_DIR/known_hosts"

if [ -f /tmp/github-ssh-keys/id_rsa ]; then
  sed 's/^[[:space:]]*//' /tmp/github-ssh-keys/id_rsa > "$SSH_DIR/github_id_rsa"
  chmod 600 "$SSH_DIR/github_id_rsa"
  if [ -f /tmp/github-ssh-keys/id_rsa.pub ]; then
    sed 's/^[[:space:]]*//' /tmp/github-ssh-keys/id_rsa.pub > "$SSH_DIR/github_id_rsa.pub"
    chmod 644 "$SSH_DIR/github_id_rsa.pub"
  fi
  cat > "$SSH_DIR/config" <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /home/nixuser/.ssh/github_id_rsa
  IdentitiesOnly yes
EOF
  chmod 600 "$SSH_DIR/config"
fi

if [ -f /tmp/ssh-keys/known_hosts ]; then
  cat /tmp/ssh-keys/known_hosts >> "$SSH_DIR/known_hosts"
fi
cat >> "$SSH_DIR/known_hosts" <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
EOF
chmod 644 "$SSH_DIR/known_hosts"

log() { echo "[workspace] $*" >&2; }

wait_for() {
  local name="$1" marker="$2" check="$3"
  for _ in $(seq 1 60); do
    if eval "$check" >/dev/null 2>&1; then
      touch "$marker"
      log "$name up"
      return 0
    fi
    sleep 2
  done
  log "WARN: $name never came up"
}

start_browser() {
  rm -rf /tmp/chromium-cdp-profile
  ( setsid /usr/bin/chromium \
      --headless=new \
      --remote-debugging-port=${CDP_PORT} \
      --remote-allow-origins=* \
      --disable-dev-shm-usage \
      --no-sandbox \
      --user-data-dir=/tmp/chromium-cdp-profile \
      about:blank </dev/null
  ) > /tmp/workspace-chromium-cdp.log 2>&1 &
  disown

  cat > /tmp/cdp-forwarder.js <<'EOF'
const net = require('net');
const ext = parseInt(process.env.CDP_EXTERNAL_PORT || '9223', 10);
const internal = parseInt(process.env.CDP_PORT || '9222', 10);
net.createServer((sock) => {
  const up = net.connect(internal, '127.0.0.1');
  sock.pipe(up);
  up.pipe(sock);
  sock.on('error', () => up.destroy());
  up.on('error', () => sock.destroy());
  sock.on('close', () => up.destroy());
  up.on('close', () => sock.destroy());
}).listen(ext, '0.0.0.0');
EOF
  ( CDP_PORT=${CDP_PORT} CDP_EXTERNAL_PORT=${CDP_EXTERNAL_PORT} setsid node /tmp/cdp-forwarder.js </dev/null
  ) > /tmp/workspace-cdp-forwarder.log 2>&1 &
  disown

  ( wait_for chromium-cdp /tmp/cdp-up "curl -sf -m 2 http://127.0.0.1:${CDP_EXTERNAL_PORT}/json/version" \
      && printf '%s' "${CDP_EXTERNAL_PORT}" > /tmp/cdp-port ) &
  disown
}

start_preview() {
  ( setsid Xvfb :99 -screen 0 1280x720x24 -nolisten tcp </dev/null ) > /tmp/workspace-xvfb.log 2>&1 &
  disown
  for _ in $(seq 1 20); do
    [ -e /tmp/.X11-unix/X99 ] && break
    sleep 0.5
  done

  rm -rf /tmp/chrome-preview-profile
  ( DISPLAY=:99 setsid /usr/bin/chromium \
      --no-sandbox \
      --disable-dev-shm-usage \
      --user-data-dir=/tmp/chrome-preview-profile \
      --no-first-run \
      --no-default-browser-check \
      about:blank </dev/null
  ) > /tmp/workspace-chromium-headed.log 2>&1 &
  disown

  ( setsid x11vnc -display :99 -forever -shared -rfbport ${PREVIEW_VNC_PORT} -localhost -nopw -quiet \
      -defer 5 -wait 5 -threads -noxrecord -noxfixes </dev/null
  ) > /tmp/workspace-x11vnc.log 2>&1 &
  disown

  ( setsid websockify --web=/usr/share/novnc ${PREVIEW_HTTP_PORT} localhost:${PREVIEW_VNC_PORT} </dev/null
  ) > /tmp/workspace-websockify.log 2>&1 &
  disown

  ( wait_for preview /tmp/preview-up "curl -sf -m 2 -o /dev/null http://127.0.0.1:${PREVIEW_HTTP_PORT}/vnc.html" \
      && printf '%s' "${PREVIEW_HTTP_PORT}" > /tmp/preview-port ) &
  disown
}

start_code_server() {
  local dir="$1"
  ( setsid code-server --bind-addr 0.0.0.0:${CODE_SERVER_PORT} --auth none \
      --disable-telemetry --disable-update-check "$dir" </dev/null
  ) > /tmp/workspace-code-server.log 2>&1 &
  disown

  ( wait_for code-server /tmp/code-server-up "curl -sf -m 2 -o /dev/null http://127.0.0.1:${CODE_SERVER_PORT}/healthz" \
      && printf '%s' "${CODE_SERVER_PORT}" > /tmp/code-server-port ) &
  disown
}

prepare_repo() {
  local dir="$1"
  if [ ! -d "$dir/.git" ]; then
    for attempt in 1 2 3 4 5; do
      log "cloning $WORKSPACE_REPO_URL ($WORKSPACE_REPO_REF) into $dir (attempt $attempt/5)"
      if git clone --depth=1 --branch "$WORKSPACE_REPO_REF" "$WORKSPACE_REPO_URL" "$dir"; then
        break
      fi
      rm -rf "$dir"
      if [ "$attempt" -eq 5 ]; then
        log "git clone failed after 5 attempts"
        return 1
      fi
      sleep $(( 5 * (1 << (attempt - 1)) ))
    done
  fi
  if [ -n "$WORKSPACE_SETUP_COMMAND" ]; then
    log "running setup command in $dir"
    ( cd "$dir" && bash -lc "$WORKSPACE_SETUP_COMMAND" ) > /tmp/workspace-setup.log 2>&1 \
      || { log "setup command failed:"; tail -30 /tmp/workspace-setup.log >&2; }
  fi
}

run_background() {
  local dir="$WORKSPACE_ROOT"
  if [ -n "$WORKSPACE_REPO_URL" ]; then
    dir="$WORKSPACE_ROOT/$(basename "${WORKSPACE_REPO_URL%.git}")"
    prepare_repo "$dir" || dir="$WORKSPACE_ROOT"
  fi
  touch /tmp/prebake-done
  log "workspace ready at $dir"
  start_browser
  start_preview
  start_code_server "$dir"
}

( run_background > /tmp/workspace-main.log 2>&1 ) &
disown

cd /app
exec node --import tsx/esm /app/src/main.ts
