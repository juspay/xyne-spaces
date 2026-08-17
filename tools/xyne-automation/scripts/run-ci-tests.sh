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

AUTOMATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# cwd = tools/ (parent of the package), which the runner uses to place artifacts.
# ts-node by path (not `pnpm exec`): it's a package dep, not a root one.
cd "$AUTOMATION_DIR/.."

exec "$AUTOMATION_DIR/node_modules/.bin/ts-node" --project "$AUTOMATION_DIR/tsconfig.json" \
  "$AUTOMATION_DIR/scripts/runner/index.ts" --mode=ci --plain "$@"
