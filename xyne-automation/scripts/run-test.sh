#!/bin/bash

set -e

#==============================================================================
# Thin wrapper — installs deps and runs the Node.js test runner
#==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUTOMATION_DIR="$SCRIPT_DIR/.."

# Install xyne-automation dependencies (includes CLI libs)
echo "Installing xyne-automation dependencies…"
(cd "$AUTOMATION_DIR" && npm install --silent)

# Clear the terminal screen
clear

# Run the Node.js test runner from xyne-automation so it can resolve local deps
export PROJECT_ROOT
cd "$AUTOMATION_DIR"
npx ts-node -r tsconfig-paths/register scripts/local-test-runner/test-runner.ts
