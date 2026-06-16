#!/usr/bin/env bash
set -u

DIRS=(
  "."
  # "apps/xyne-spaces"
  "backend"
  # "backend/backend"
  # "backend/eslint-rules"
  "dashboard"
  # "electron"
  # "framework"
  # "lotus"
  # "packages/kata-sdk"
  "shared"
  # "site"
  # "tools/fcm-ota-trigger"
  # "xyne-claw"
  # "xyne-claw-auth/backend"
  # "xyne-claw-auth/frontend"
  # "xyne-claw-shared"
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=()

for d in "${DIRS[@]}"; do
  echo ""
  echo "================================================================"
  echo "==> Installing in: $d"
  echo "================================================================"
  if (cd "$ROOT/$d" && npm install); then
    echo "✓ $d"
  else
    echo "✗ $d (failed)"
    FAILED+=("$d")
  fi
done

echo ""
echo "================================================================"
echo "Summary"
echo "================================================================"
echo "Total: ${#DIRS[@]}, Failed: ${#FAILED[@]}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed directories:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
  exit 1
fi
