#!/bin/bash
# Verifies every image `pnpm run test` (via docker-compose.dev.yml +
# docker-compose.test.yml) needs can actually be pulled from inside the
# DinD sidecar — i.e. that Squid's hostname allowlist covers every registry
# these images live in. Does NOT run docker compose, does NOT run any test —
# only `docker pull`, one image at a time, reporting pass/fail per image.
#
# Purpose: isolate "can we reach every registry" from "does the test suite
# pass" — meant to be run once after any Squid allowlist change, before
# attempting a real docker-compose.test.yml run.
#
# Uses portable POSIX grep -E (no PCRE \K) — BSD grep (macOS) doesn't support
# -P at all, so this must not depend on it.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

COMPOSE_FILES=(docker-compose.dev.yml docker-compose.test.yml)

images_file=$(mktemp)
dockerfiles_file=$(mktemp)

# 1. Direct `image:` references in the compose files.
for f in "${COMPOSE_FILES[@]}"; do
  grep -E '^[[:space:]]*image:[[:space:]]*[^[:space:]]+' "$f" 2>/dev/null \
    | sed -E 's/^[[:space:]]*image:[[:space:]]*//' >> "$images_file"
done

# 2. `build:` entries — resolve to their Dockerfile's FROM line(s) instead,
#    since that's what containerd actually has to pull for these.
for f in "${COMPOSE_FILES[@]}"; do
  [ -f "$f" ] || continue
  awk '
    /^[[:space:]]*build:/ { in_build=1; ctx=""; df=""; next }
    in_build && /^[[:space:]]*context:/ { sub(/^[[:space:]]*context:[[:space:]]*/, ""); ctx=$0; next }
    in_build && /^[[:space:]]*dockerfile:/ { sub(/^[[:space:]]*dockerfile:[[:space:]]*/, ""); df=$0; print ctx"/"df; in_build=0; next }
  ' "$f"
done | sort -u > "$dockerfiles_file"

while IFS= read -r dockerfile_path; do
  [ -z "$dockerfile_path" ] && continue
  dockerfile_path="${dockerfile_path#./}"
  if [ -f "$dockerfile_path" ]; then
    grep -E '^FROM[[:space:]]+[^[:space:]]+' "$dockerfile_path" 2>/dev/null \
      | sed -E 's/^FROM[[:space:]]+//' >> "$images_file"
  else
    echo "WARNING: referenced Dockerfile not found: $dockerfile_path" >&2
  fi
done < "$dockerfiles_file"

mapfile -t images < <(sort -u "$images_file" | grep -v '^[[:space:]]*$')
rm -f "$images_file" "$dockerfiles_file"

echo "Found ${#images[@]} distinct image(s) to verify:"
printf '  %s\n' "${images[@]}"
echo

failed=()
for img in "${images[@]}"; do
  echo "==> docker pull $img"
  if docker pull --platform linux/amd64 "$img" > /tmp/pull-out.log 2>&1; then
    echo "    OK"
  else
    echo "    FAILED"
    tail -5 /tmp/pull-out.log | sed 's/^/    | /'
    failed+=("$img")
  fi
done

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "All ${#images[@]} images fetchable."
  exit 0
else
  echo "${#failed[@]} image(s) failed to pull:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
