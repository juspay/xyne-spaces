#!/usr/bin/env bash
# Keep remaining Compose references visible during the incremental Nix migration.
set -euo pipefail
cd "$(dirname "$0")/../.."
export LC_ALL=C

matches=$(mktemp)
allowed=$(mktemp)
trap 'rm -f "$matches" "$allowed"' EXIT

# grep and rg return 1 for no matches; other failures must stop the check.
scan() {
  local status=0
  "$@" || status=$?
  if [ "$status" -gt 1 ]; then
    echo "Failed to scan Compose references" >&2
    return "$status"
  fi
}

# A checkout needs Git metadata to omit ignored build output while including
# tracked files even when ignore rules name them. The flake snapshot contains
# only source files and has no .git metadata, so rg scans that snapshot directly.
if [ -e .git ]; then
  paths=(. ':(exclude)deployment/**' ':(exclude)helm-charts/**'
    ':(exclude)**/node_modules/**' ':(exclude)nix/compose-refs.allowlist')
  scan git grep -l -E 'docker-compose|docker compose' -- "${paths[@]}" > "$matches"
  # --exclude-standard hides ignored tracked files too; the first scan covers them.
  scan git grep -l --untracked --exclude-standard -E 'docker-compose|docker compose' \
    -- "${paths[@]}" >> "$matches"
else
  scan rg --hidden --no-ignore --files-with-matches \
    --glob '!.git/**' --glob '!**/node_modules/**' \
    --glob '!deployment/**' --glob '!helm-charts/**' \
    --glob '!nix/compose-refs.allowlist' \
    -e 'docker-compose|docker compose' . > "$matches"
fi
sed 's|^./||' "$matches" | sort -u > "$allowed"
cp "$allowed" "$matches"
grep -vE '^[[:space:]]*(#|$)' nix/compose-refs.allowlist | sort -u > "$allowed" || true

unexpected=$(comm -23 "$matches" "$allowed")
if [ -n "$unexpected" ]; then
  printf 'Unlisted Compose references:\n%s\n' "$unexpected" >&2
  echo 'migrate to Nix or, for a new reference, justify it in the PR' >&2
  exit 1
fi
echo 'All Compose references are allowlisted by file path.'
