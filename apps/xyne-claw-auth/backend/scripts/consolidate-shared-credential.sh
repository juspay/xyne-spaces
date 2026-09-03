#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_AGENT:?agent slug whose fresh dedicated credential becomes the shared one}"
: "${NEW_NAME:?display name for the new shared credential (must not already exist)}"
PROVIDER="${PROVIDER:-codex}"
OLD_ROWS="${OLD_ROWS:-}"
EXTRA_AGENTS="${EXTRA_AGENTS:-}"
APPLY="${APPLY:-0}"
CONTEXT="${KUBE_CONTEXT:-}"
NS="${NAMESPACE:-xyne-apps}"

KUBECTL=(kubectl)
[ -n "$CONTEXT" ] && KUBECTL+=(--context "$CONTEXT")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/consolidate-shared-credential.cjs"
REMOTE=/repo/apps/xyne-claw-auth/backend/scripts/consolidate-shared-credential.cjs

POD="$("${KUBECTL[@]}" get pods -n "$NS" -l app=xyne-claw-auth -o name | grep -v frontend | head -1 | cut -d/ -f2)"
[ -n "$POD" ] || { echo "no xyne-claw-auth pod found"; exit 1; }

"${KUBECTL[@]}" cp "$SCRIPT" "$NS/$POD:$REMOTE" -c xyne-claw-auth
"${KUBECTL[@]}" exec -n "$NS" "$POD" -c xyne-claw-auth -- sh -c \
  "cd /repo/apps/xyne-claw-auth/backend && PROVIDER='$PROVIDER' SOURCE_AGENT='$SOURCE_AGENT' NEW_NAME='$NEW_NAME' OLD_ROWS='$OLD_ROWS' EXTRA_AGENTS='$EXTRA_AGENTS' APPLY='$APPLY' node $REMOTE; rm -f $REMOTE"
