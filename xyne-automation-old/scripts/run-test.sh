#!/bin/bash

set -e

#==============================================================================
# Thin wrapper — installs deps and runs the Node.js test runner
#==============================================================================

# Detect output mode
OUTPUT_MODE="${OUTPUT_MODE:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUTOMATION_DIR="$SCRIPT_DIR/.."

# Set TERM fallback in plain mode environments where it's not set
if [ "$OUTPUT_MODE" = "plain" ] && [ -z "$TERM" ]; then
  export TERM=dumb
fi

# Install xyne-automation dependencies (includes CLI libs)
echo "Installing xyne-automation dependencies…"
(cd "$AUTOMATION_DIR" && NODE_ENV=development npm install --silent)

# Clear the terminal screen (skip in plain mode)
if [ "$OUTPUT_MODE" != "plain" ]; then
  clear
fi

# Run the Node.js test runner from xyne-automation so it can resolve local deps
export PROJECT_ROOT
cd "$AUTOMATION_DIR"
npx ts-node -r tsconfig-paths/register scripts/local-test-runner/test-runner.ts
