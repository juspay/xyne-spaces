#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

exec npx ts-node --project xyne-automation/tsconfig.json \
  xyne-automation/scripts/runner/index.ts --mode=ci --plain "$@"
