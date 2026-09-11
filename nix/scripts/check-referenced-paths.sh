#!/usr/bin/env bash
#
# Guard against source-path drift in the Nix bootstrap (project.nix).
#
# The process-compose stack shells out to fixed source paths (the backend dir,
# the python transcription agent, the dashboard). If the repo layout moves but
# project.nix is not updated, the affected step silently does the wrong thing.
#
# This exact failure shipped once already: the repo restructure (#21) moved
# backend/ -> apps/backend/, but project.nix still set
# BACKEND_DIR="$PROJECT_ROOT/backend". db-setup then found no backend, printed
# "Skipping database setup", and exited 0 — so schema push, ACL seed, and admin
# creation silently stopped running on every fresh `nix run .#xyne-space-services`.
#
# A `nix flake check` / `nix build` cannot catch this: the flake still evaluates
# and builds fine. Only a check that resolves the *referenced* paths catches it.
# This script does exactly that, with no Nix or service boot required.
set -euo pipefail

# repo root = two levels up from nix/scripts/
cd "$(dirname "$0")/../.."
ROOT="$PWD"
fail=0

check() {
  local p="$1" src="$2"
  # Skip runtime/generated locations that legitimately do not exist at checkout.
  case "$p" in
    data/* | .logs* | .nix-cache* | *node_modules* | dist/*) return 0 ;;
  esac
  if [ ! -e "$ROOT/$p" ]; then
    echo "::error file=$src::Nix bootstrap references a missing source path: $p"
    fail=1
  fi
}

# 1. $PROJECT_ROOT/<path> references.
# shellcheck disable=SC2016  # we grep for the literal string $PROJECT_ROOT, no expansion intended
while IFS= read -r ref; do
  check "${ref#\$PROJECT_ROOT/}" project.nix
done < <(grep -oE '\$PROJECT_ROOT/[A-Za-z0-9_./-]+' project.nix | sort -u)

# 2. Literal `cd <relative-path>` references (skip $-prefixed and absolute paths).
while IFS= read -r line; do
  p="${line#cd }"
  case "$p" in /* | \$* | "") continue ;; esac
  check "$p" project.nix
done < <(grep -oE 'cd [A-Za-z0-9_./-]+' project.nix | sort -u)

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Nix bootstrap (project.nix) references a path that does not exist in the tree." >&2
  echo "If you moved a directory, update project.nix to match the new layout." >&2
  exit 1
fi

echo "✓ all source paths referenced by project.nix exist"
