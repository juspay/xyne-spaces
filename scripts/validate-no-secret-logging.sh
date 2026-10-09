#!/bin/bash

# Secret-in-log-message Guard
# ---------------------------
# Blocks a commit / PR from adding a NEW log call that interpolates a secret into
# the log MESSAGE text, e.g.
#
#   log.info(`Setting cookie: ${name}=${value}`)
#   logger.debug(`calling upstream with Bearer ${accessToken}`)
#   console.log(`key=${this.apiKey}`)
#
# Why: the @xyne/logger shredder redacts secret-named FIELDS and secret-SHAPED
# values at runtime, but it cannot know that an arbitrary `${value}` inside a
# message string is a credential. Structured fields are the safe path:
#
#   log.info("Setting cookie", { name, maxAge })   // value omitted
#   log.info("upstream call", { tokenPresent: !!accessToken })
#
# Like the raw-SQL guard, this compares the per-file COUNT of offending lines in
# the OLD content vs the NEW content and fails only when it goes UP, so existing
# code is never retroactively flagged and moving/reindenting a line is free.
#
# Escape hatch (reviewed): append `// log-safe: <reason>` to the line, e.g. when
# the interpolated identifier only *sounds* like a secret. The marker is visible
# in the PR diff, so a reviewer signs off on it.
#
# Usage:
#   scripts/validate-no-secret-logging.sh              # staged changes (pre-commit)
#   scripts/validate-no-secret-logging.sh --base <ref> # <ref>...HEAD
#   scripts/validate-no-secret-logging.sh --ci         # CI: merge-base with $CHANGE_TARGET/main
#   scripts/validate-no-secret-logging.sh --scan-all   # report every existing hit (no fail)
#
# Exit: 0 clean · 1 violation · 2 usage error.

set -euo pipefail

BASE_REF=""
CI_MODE=0
SCAN_ALL=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --base) BASE_REF="${2:-}"; [ -n "$BASE_REF" ] || { echo "❌ secret-logging guard: --base requires a ref" >&2; exit 2; }; shift 2 ;;
        --ci) CI_MODE=1; shift ;;
        --scan-all) SCAN_ALL=1; shift ;;
        *) echo "❌ secret-logging guard: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

# A line is flagged when it contains a log call AND either
#   (A) interpolates an identifier whose LAST segment names a secret
#       (${token}, ${accessToken}, ${req.headers.authorization}, ${this.apiKey}), or
#   (B) names a secret and prints a plain value right after it
#       ("token=${t}", "Bearer ${x}"), or
#   (C) prints a cookie pair ("cookie: ${name}=${value}").
# Presence/length checks (${!!token}, ${token.length}, ${tokenCount},
# ${t ? "set" : "missing"}) and names (${cookieNames}) are NOT flagged.
LOG_CALL='\b(?:log|logger|console|this\.log|this\.logger|childLogger)\.(?:info|warn|error|debug|log|trace|verbose|fatal)\s*\('
SECRET_STEM='(?:password|passwd|pwd|secret|token|api_?key|cookie|authorization|credentials?|jwt|private_?key|passphrase)'
IDENT="[\\w.?\\[\\]'\"]"
PAT_A="\\\$\\{\\s*${IDENT}*?${SECRET_STEM}\\s*\\}"
PAT_B="(?:${SECRET_STEM}\\s*=|bearer\\s+)\\s*\\\$\\{\\s*${IDENT}+\\s*\\}"
PAT_C="cookie[^\`]{0,30}\\\$\\{\\s*${IDENT}+\\s*\\}\\s*=\\s*\\\$\\{\\s*${IDENT}+\\s*\\}"
SAFE_MARK='//\s*log-safe:'

INCLUDE_RE='\.(ts|tsx|js|jsx|mjs|cjs)$'
EXCLUDED_RE='(^|/)(node_modules|dist|build|generated|release)/|\.(test|spec)\.[jt]sx?$|(^|/)(test|tests|__tests__)/|\.min\.js$'
SELF_PATH='scripts/validate-no-secret-logging.sh'

# Print offending lines (with line numbers) of stdin.
offending() {
    grep -nP "$LOG_CALL" 2>/dev/null \
        | grep -iP "$PAT_A|$PAT_B|$PAT_C" 2>/dev/null \
        | grep -vP "$SAFE_MARK" 2>/dev/null || true
}
count() { offending | grep -c . || true; }

if [ "$SCAN_ALL" = "1" ]; then
    git ls-files | grep -E "$INCLUDE_RE" | grep -vE "$EXCLUDED_RE" | while read -r f; do
        [ -f "$f" ] || continue
        offending < "$f" | sed "s|^|$f:|"
    done
    exit 0
fi

if [ "$CI_MODE" = "1" ]; then
    [ -z "$BASE_REF" ] || { echo "❌ secret-logging guard: pass either --ci or --base, not both" >&2; exit 2; }
    BASE_BRANCH="${CHANGE_TARGET:-main}"
    git fetch --no-tags origin "+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}" 2>/dev/null || true
    MB="$(git merge-base HEAD "origin/${BASE_BRANCH}" 2>/dev/null || true)"
    if [ -z "$MB" ]; then
        git fetch --no-tags --deepen=200 origin "${BASE_BRANCH}" 2>/dev/null || git fetch --unshallow 2>/dev/null || true
        MB="$(git merge-base HEAD "origin/${BASE_BRANCH}" 2>/dev/null || true)"
    fi
    BASE_REF="${MB:-origin/${BASE_BRANCH}}"
    echo "secret-logging guard (--ci): diffing against ${BASE_REF}"
fi

if [ -n "$BASE_REF" ]; then
    git rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null 2>&1 || {
        echo "❌ secret-logging guard: base ref '${BASE_REF}' does not resolve to a commit — refusing to pass vacuously." >&2; exit 2; }
    OLD_SPEC="${BASE_REF}:"; NEW_SPEC="HEAD:"
    diff_status() { git diff --name-status -M "${BASE_REF}...HEAD"; }
else
    OLD_SPEC="HEAD:"; NEW_SPEC=":"
    diff_status() { git diff --cached --name-status -M; }
fi

FAILED=0
while IFS=$'\t' read -r status path1 path2; do
    case "$status" in
        D*) continue ;;
        R*|C*) old_path="$path1"; new_path="$path2" ;;
        *) old_path="$path1"; new_path="$path1" ;;
    esac
    [[ "$new_path" =~ $INCLUDE_RE ]] || continue
    [[ "$new_path" =~ $EXCLUDED_RE ]] && continue
    [ "$new_path" = "$SELF_PATH" ] && continue

    new_count=$(git show "${NEW_SPEC}${new_path}" 2>/dev/null | count)
    old_count=0
    if [[ "$status" != A* ]]; then
        old_count=$(git show "${OLD_SPEC}${old_path}" 2>/dev/null | count)
    fi
    if [ "${new_count:-0}" -gt "${old_count:-0}" ]; then
        FAILED=1
        echo "❌ ${new_path}: log call(s) interpolating a secret into the message (${old_count} → ${new_count}):"
        git show "${NEW_SPEC}${new_path}" | offending | sed 's/^/     /'
    fi
done < <(diff_status)

if [ "$FAILED" = "1" ]; then
    cat <<'EOF'

   Log the fact, not the secret. Move values into structured fields the shredder
   can see, and log presence/length instead of the value:
       log.info("Setting cookie", { name, maxAge })
       log.info("upstream call", { tokenPresent: !!token })
   If the identifier only sounds like a secret, append `// log-safe: <reason>`.
EOF
    exit 1
fi
echo "✅ secret-logging guard: no new secrets interpolated into log messages"
