#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for arg in "$@"; do
  case "$arg" in
    --yes) ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

echo "Spaces SDLC data and queue:"
(
  cd apps/backend
  pnpm exec dotenv -e .env.local -- sh -c \
    'NODE_ENV=development node --import tsx scripts/cleanup-sdlc-local.ts "$@"' -- "$@"
)

echo "Claw SDLC run history:"
CLAW_CLEANUP="apps/xyne-claw-auth/backend/scripts/cleanup-sdlc-local.ts"
if [[ -f "$CLAW_CLEANUP" ]]; then
  (
    cd apps/xyne-claw-auth/backend
    node --import tsx --env-file=.env scripts/cleanup-sdlc-local.ts "$@"
  )
else
  echo "Skipped: Claw cleanup helper is delivered by feature/sdlc-claw."
fi
