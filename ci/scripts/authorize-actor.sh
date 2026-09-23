#!/usr/bin/env bash
set -euo pipefail

ALLOWED="${ALLOWED:-}"
ACTOR="${ACTOR:?ACTOR is required}"

if [ -z "${ALLOWED}" ]; then
  echo "::error::The allow-list variable is not set. Add an Actions variable with the comma-separated GitHub usernames allowed to publish."
  exit 1
fi

actor_lc="$(printf '%s' "${ACTOR}" | tr '[:upper:]' '[:lower:]')"
IFS=', ' read -r -a list <<< "${ALLOWED}"
for u in "${list[@]}"; do
  [ -z "${u}" ] && continue
  if [ "$(printf '%s' "${u}" | tr '[:upper:]' '[:lower:]')" = "${actor_lc}" ]; then
    echo "Authorized: ${ACTOR}"
    exit 0
  fi
done

echo "::error::${ACTOR} is not authorized. Allowed: ${ALLOWED}"
exit 1
