#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# Only call `nvm use` if a .nvmrc is present. Without this guard, hosts that
# have nvm pre-installed (e.g. GitHub-hosted ubuntu-latest) fail under
# `set -u`: nvm use prints "No version provided and no .nvmrc file found"
# then hits an unbound `VERSION` variable inside nvm.sh.
# shellcheck disable=SC1091
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  [ -f .nvmrc ] && nvm use
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

exec pnpm exec ts-node --project tools/xyne-automation/tsconfig.json \
  tools/xyne-automation/scripts/runner/index.ts --mode=ci --plain "$@"
