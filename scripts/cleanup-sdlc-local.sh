#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

expect_repo_value=false
scoped_cleanup=false
for arg in "$@"; do
  if [[ "$expect_repo_value" == true ]]; then
    [[ -n "$arg" ]] || { echo "--repo requires a value" >&2; exit 1; }
    expect_repo_value=false
    continue
  fi
  case "$arg" in
    --) ;;
    --yes) ;;
    --repo) expect_repo_value=true; scoped_cleanup=true ;;
    --repo=*) [[ -n "${arg#--repo=}" ]] || { echo "--repo requires a value" >&2; exit 1; }; scoped_cleanup=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
[[ "$expect_repo_value" == false ]] || { echo "--repo requires a value" >&2; exit 1; }

claw_scope_file=""
if [[ "$scoped_cleanup" == true ]]; then
  claw_scope_file="$(mktemp "${TMPDIR:-/tmp}/sdlc-cleanup.XXXXXX")"
  trap 'rm -f "$claw_scope_file"' EXIT
fi
cleanup_args=("$@")
if [[ -n "$claw_scope_file" ]]; then
  cleanup_args+=(--claw-scope-file "$claw_scope_file")
fi

echo "Spaces SDLC data and queue:"
(
  cd apps/backend
  pnpm exec dotenv -e .env.local -- sh -c \
    'NODE_ENV=development node --import tsx scripts/cleanup-sdlc-local.ts "$@"' -- "${cleanup_args[@]}"
)

echo "Claw SDLC run history:"
(
  cd apps/xyne-claw-auth/backend
  node --import tsx --env-file=.env scripts/cleanup-sdlc-local.ts "${cleanup_args[@]}"
)
