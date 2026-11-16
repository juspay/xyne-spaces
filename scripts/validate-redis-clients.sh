#!/usr/bin/env bash
set -euo pipefail

# Every backend Redis client must come from createRedisClient (services/redisFactory.ts), which
# wraps it with value encryption. A bare `new Redis(` reads and writes plaintext.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "${SCRIPT_DIR%/*}")"
ROOT="$REPO_ROOT/apps/backend/src"
ALLOWED_RE='apps/backend/src/services/redisFactory\.ts:'
EXCLUDED_RE='(^|/)(node_modules|dist|build|generated|__tests__)/|\.test\.ts:|:[0-9]+:[[:space:]]*(//|\*)'

hits=$(grep -rnE 'new (Redis|IORedis)\(' "$ROOT" --include='*.ts' 2>/dev/null \
  | grep -vE "$ALLOWED_RE" \
  | grep -vE "$EXCLUDED_RE" \
  || true)

if [ -n "$hits" ]; then
  echo "❌ Redis client guard: Redis client constructed outside services/redisFactory.ts"
  echo "$hits" | sed "s|^$REPO_ROOT/||; s/^/    /"
  echo ""
  echo "Use createRedisClient() so values are encrypted at rest."
  exit 1
fi

echo "✅ Redis client guard: every Redis client comes from createRedisClient()."
