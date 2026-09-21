#!/usr/bin/env bash
# =============================================================================
# OSS hygiene sweep — blocks internal-infrastructure references and
# credential-shaped strings from entering this repository.
#
# Modes:
#   scripts/oss-hygiene-sweep.sh --base <ref>   Scan ADDED lines of the diff
#                                               between <ref> and HEAD.
#                                               (default ref: origin/main)
#   scripts/oss-hygiene-sweep.sh --full         Scan ALL tracked files, minus
#                                               the allowlist.
#
# Used by .github/workflows/oss-hygiene.yml on every PR (diff mode — blocks NEW
# leaks) and on demand (full audit). Exit 0 = clean, exit 1 = findings.
#
# Semantics:
#   - Credential-shaped patterns are enforced on EVERY added line / tracked
#     file, with no allowlist relaxation.
#   - Internal-hostname patterns skip files listed in the allowlist
#     (scripts/oss-hygiene-allowlist.txt by default; override with
#     OSS_HYGIENE_ALLOWLIST). Every allowlist entry must carry a removal
#     condition in that file — the goal is an empty allowlist.
#
# NOTE: the hostname pattern below is assembled from string fragments on
# purpose — writing the tokens contiguously would make this very file match
# the sweep and fail its own PR.
# =============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# --- Pattern assembly (fragmented; see NOTE above) ---------------------------
_J="jus""pay"
_R="rb""ihub"
HOSTNAME_PATTERN="${_J}\\.(net|in|com)|${_R}|svc\\.k8s"

CRED_PATTERN='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[bporsa]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY----|(postgres|postgresql|mysql|mongodb|redis|amqp)(\+srv)?://[A-Za-z0-9_]+:[^@[:space:]]+@'

ALLOWLIST="${OSS_HYGIENE_ALLOWLIST:-scripts/oss-hygiene-allowlist.txt}"

fail=0

read_allowlist() {
  # prints allowlisted paths, one per line (comments/blanks stripped)
  if [ -f "${ALLOWLIST}" ]; then
    grep -v -E '^\s*(#|$)' "${ALLOWLIST}" || true
  fi
}

report() {
  # $1 = findings (may be empty), $2 = label, $3 = hint
  if [ -n "$1" ]; then
    echo "::error title=OSS hygiene: ${2} detected::${3}"
    printf '%s\n' "$1" | sed 's/^/  /'
    fail=1
  fi
}

mode="${1:-}"
case "${mode}" in
  --base)
    base_ref="${2:-origin/main}"
    if ! git rev-parse --verify -q "${base_ref}" >/dev/null; then
      echo "oss-hygiene: base ref '${base_ref}' not found" >&2
      exit 2
    fi
    merge_base="$(git merge-base "${base_ref}" HEAD)"

    # Added lines only, tagged with their file. Awk skips +++ headers.
    added="$(git diff --unified=0 "${merge_base}" HEAD | awk '
      /^\+\+\+ b\// { file = substr($0, 7) }
      /^\+/ && !/^\+\+\+/ { print file "\t" substr($0, 2) }')"

    if [ -n "${added}" ]; then
      # Credentials: strict on every added line.
      cred_hits="$(printf '%s\n' "${added}" | grep -E "${CRED_PATTERN}" || true)"

      # Hostnames: strict on every added line EXCEPT in allowlisted files.
      host_scope="${added}"
      while IFS= read -r af; do
        [ -n "${af}" ] || continue
        host_scope="$(printf '%s\n' "${host_scope}" | grep -v -F -e "${af}"$'\t' || true)"
      done < <(read_allowlist)
      host_hits="$(printf '%s\n' "${host_scope}" | grep -i -E "${HOSTNAME_PATTERN}" || true)"

      report "${host_hits}" "internal-hostname reference" \
        "Added lines must not contain internal hostnames. Parameterize via env/config instead."
      report "${cred_hits}" "credential-shaped string" \
        "Added lines must not contain credential-shaped strings."
    fi
    ;;
  --full)
    [ -f "${ALLOWLIST}" ] || { echo "oss-hygiene: allowlist ${ALLOWLIST} missing" >&2; exit 2; }

    hits="$( { git grep -I -i -l -E "${HOSTNAME_PATTERN}" -- . || true;
               git grep -I -l -E "${CRED_PATTERN}" -- . || true; } | sort -u )"

    if [ -n "${hits}" ]; then
      offenders="$(printf '%s\n' "${hits}" | grep -vxF -f <(read_allowlist) || true)"
      report "${offenders}" "full-tree audit findings" \
        "Tracked files matching the sweep that are NOT in ${ALLOWLIST}."
    fi
    ;;
  *)
    echo "usage: $0 --base <ref> | --full" >&2
    exit 2
    ;;
esac

if [ "${fail}" -ne 0 ]; then
  echo "oss-hygiene: FAILED — see findings above."
  exit 1
fi
echo "oss-hygiene: clean."
