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

exec npx ts-node --project "$AUTOMATION_DIR/tsconfig.json" "$AUTOMATION_DIR/scripts/runner/index.ts" "$@"
