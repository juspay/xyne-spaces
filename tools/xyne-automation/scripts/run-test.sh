#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$(cd "$AUTOMATION_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Set TERM for non-interactive environments
if [ -z "$TERM" ] || [ "$TERM" = "dumb" ]; then
  export OUTPUT_MODE=plain
fi

# Silence node's experimental EnvHttpProxyAgent (UNDICI-EHPA) notice — noise for this harness.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--disable-warning=UNDICI-EHPA"

# ts-node by path (not `pnpm exec`): keeps cwd at PROJECT_ROOT, which the runner uses to place artifacts.
exec "$AUTOMATION_DIR/node_modules/.bin/ts-node" --project "$AUTOMATION_DIR/tsconfig.json" "$AUTOMATION_DIR/scripts/runner/index.ts" "$@"
