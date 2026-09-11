#!/usr/bin/env bash
#
# DEV-ONLY: wire a real GitHub webhook to your LOCAL Release Manager backend.
#
# Opens a cloudflared tunnel to the backend, waits for its public URL, then
# registers (idempotently) a `pull_request` + `issue_comment` webhook on the repo
# pointing at that URL. Leave this running while you test — the tunnel stays up
# in this terminal.
#
#   GITHUB_TOKEN=ghp_xxx bash register-github-webhook.sh <owner/repo> <workspaceId>
#
# Reads the shared secret from backend/.env.local (SCM_WEBHOOK_SECRET) so it
# matches what the backend verifies. Nothing is hardcoded.
#
set -euo pipefail

REPO="${1:-}"
WORKSPACE_ID="${2:-}"
BACKEND_PORT="${BACKEND_PORT:-3001}"

[ -n "$REPO" ] || { echo "❌ usage: GITHUB_TOKEN=ghp_xxx bash register-github-webhook.sh <owner/repo> <workspaceId>"; exit 1; }
[ -n "$WORKSPACE_ID" ] || { echo "❌ usage: GITHUB_TOKEN=ghp_xxx bash register-github-webhook.sh <owner/repo> <workspaceId>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env.local"

[ -n "${GITHUB_TOKEN:-}" ] || { echo "❌ GITHUB_TOKEN env var is required"; exit 1; }
command -v cloudflared >/dev/null || { echo "❌ cloudflared not installed (brew install cloudflared)"; exit 1; }

SECRET="$(grep -E '^SCM_WEBHOOK_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
[ -n "$SECRET" ] || { echo "❌ SCM_WEBHOOK_SECRET not found in $ENV_FILE — set it (and restart the backend) first"; exit 1; }

echo "▶ Repo:       $REPO"
echo "▶ Workspace:  $WORKSPACE_ID"
echo "▶ Backend:    http://localhost:$BACKEND_PORT"

# 1. Start the tunnel and capture its public URL.
LOG="$(mktemp -t cf-tunnel.XXXXXX.log)"
cloudflared tunnel --url "http://localhost:$BACKEND_PORT" > "$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null || true' EXIT

echo "▶ Starting cloudflared tunnel…"
PUBLIC=""
for _ in $(seq 1 40); do
  PUBLIC="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$PUBLIC" ] && break
  sleep 1
done
[ -n "$PUBLIC" ] || { echo "❌ Tunnel URL never appeared. Log:"; cat "$LOG"; exit 1; }
echo "✓ Tunnel: $PUBLIC"

HOOK_URL="$PUBLIC/api/webhooks/github/$WORKSPACE_ID"
API="https://api.github.com/repos/$REPO/hooks"
AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")

# 2. Remove stale trycloudflare hooks from previous runs (URLs change each start).
for id in $(curl -sS "${AUTH[@]}" "$API" | grep -oE '"id": *[0-9]+|trycloudflare' | paste - - | grep trycloudflare | grep -oE '[0-9]+' || true); do
  curl -sS -X DELETE "${AUTH[@]}" "$API/$id" >/dev/null && echo "✓ Removed stale webhook $id"
done

# 3. Register the webhook.
RESP="$(curl -sS -X POST "${AUTH[@]}" "$API" -d "{
  \"name\":\"web\",
  \"active\":true,
  \"events\":[\"pull_request\",\"issue_comment\"],
  \"config\":{\"url\":\"$HOOK_URL\",\"content_type\":\"json\",\"secret\":\"$SECRET\",\"insecure_ssl\":\"0\"}
}")"
HOOK_ID="$(printf '%s' "$RESP" | grep -oE '"id": *[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
if [ -n "$HOOK_ID" ]; then
  echo "✓ Webhook registered (id $HOOK_ID) → $HOOK_URL"
else
  echo "❌ Webhook registration failed:"; printf '%s\n' "$RESP"; exit 1
fi

echo
echo "🎉 Ready. Keep this terminal open (tunnel is live)."
echo "   Now restart the backend so it loads the new code + SCM_WEBHOOK_SECRET,"
echo "   then merge a hotfix PR. Watch GitHub → Settings → Webhooks → Recent Deliveries (want 200)."
echo "   Press Ctrl-C here to tear down the tunnel."
wait $CF_PID
