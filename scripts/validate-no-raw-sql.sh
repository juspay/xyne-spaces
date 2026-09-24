#!/bin/bash

# Raw SQL Guard
# -------------
# Blocks a commit / PR from introducing a NEW `$queryRaw` / `$executeRaw` call
# (including the `...Unsafe` variants) in ANY file.
#
# Why: these two APIs are the only way to reach the database without going
# through the Prisma query builder — and therefore without going through the
# tenant extensions in apps/backend/src/database/tenant/. The ACL read-filter
# and the workspaceId stamper both hook the query builder; a raw query is
# scoped to no workspace by anything, which is exactly the tenant-isolation
# bug scripts/validate-workspace-id.sh exists to prevent one layer up.
#
# Existing raw calls are NEVER retroactively flagged. The guard compares the
# per-file COUNT of raw calls in the OLD content vs the NEW content and fails
# only when it goes UP. Counting (rather than scanning added `+` diff lines)
# is deliberate — it means re-indenting, renaming a variable inside, or moving
# an existing raw-SQL block does NOT false-fire. Same rationale as the enum
# guard's OLD-vs-NEW set comparison. Deleting raw SQL always passes.
#
# There is NO escape hatch: no inline marker comment, no allowlist file. A
# query that genuinely cannot be expressed via the query builder needs a
# separate, reviewed PR amending this script.
#
# Usage:
#   scripts/validate-no-raw-sql.sh              # staged changes (pre-commit)
#   scripts/validate-no-raw-sql.sh --base <ref> # <ref>...HEAD (explicit base)
#   scripts/validate-no-raw-sql.sh --ci         # CI: auto-resolve base branch
#                                               #   merge-base ($CHANGE_TARGET/main),
#                                               #   incl. shallow-clone fetch fallback
#
# Exit: 0 clean · 1 violation · 2 usage error (unknown flag / unresolvable base).

set -euo pipefail

BASE_REF=""
CI_MODE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --base)
            BASE_REF="${2:-}"
            if [ -z "$BASE_REF" ]; then
                echo "❌ raw SQL guard: --base requires a ref argument" >&2
                exit 2
            fi
            shift 2
            ;;
        --ci)
            CI_MODE=1
            shift
            ;;
        *)
            echo "❌ raw SQL guard: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

# --ci: resolve the base-branch merge-base ourselves so callers stay a single
# line. Uses $CHANGE_TARGET (the PR target branch) or falls back to main, and
# handles shallow PR clones that lack the base ref / merge-base.
if [ "$CI_MODE" = "1" ]; then
    if [ -n "$BASE_REF" ]; then
        echo "❌ raw SQL guard: pass either --ci or --base, not both" >&2
        exit 2
    fi
    BASE_BRANCH="${CHANGE_TARGET:-main}"
    git fetch --no-tags origin "+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}" 2>/dev/null || true
    MB="$(git merge-base HEAD "origin/${BASE_BRANCH}" 2>/dev/null || true)"
    if [ -z "$MB" ]; then
        git fetch --no-tags --deepen=200 origin "${BASE_BRANCH}" 2>/dev/null \
            || git fetch --unshallow 2>/dev/null || true
        MB="$(git merge-base HEAD "origin/${BASE_BRANCH}" 2>/dev/null || true)"
    fi
    # Fall back to the remote branch tip if merge-base is still unresolvable; the
    # commit-existence check below then fails loud rather than passing vacuously.
    BASE_REF="${MB:-origin/${BASE_BRANCH}}"
    echo "raw SQL guard (--ci): diffing against ${BASE_REF}"
fi

# Resolve OLD/NEW sources. In --base mode the base MUST resolve to a real commit,
# otherwise we refuse to run (a guard that can't find its baseline must fail loud,
# never pass vacuously green).
if [ -n "$BASE_REF" ]; then
    if ! git rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null 2>&1; then
        echo "❌ raw SQL guard: base ref '${BASE_REF}' does not resolve to a commit." >&2
        echo "   Refusing to run — this would otherwise check nothing and pass green." >&2
        exit 2
    fi
    OLD_SPEC="${BASE_REF}:"
    NEW_SPEC="HEAD:"
    # -M so a moved file is compared against its ORIGINAL path, not against
    # nothing (which would read as "old count 0" and false-fire).
    diff_status() { git diff --name-status -M "${BASE_REF}...HEAD"; }
else
    OLD_SPEC="HEAD:"
    NEW_SPEC=":" # the index (staged)
    diff_status() { git diff --cached --name-status -M; }
fi

# The entire detection surface: $queryRaw, $queryRawUnsafe, $executeRaw,
# $executeRawUnsafe — tagged-template form and call form alike.
RAW_RE='\$(query|execute)Raw(Unsafe)?'

# Paths that are never authored by hand. The generated Prisma clients DEFINE
# these methods, so scanning them would fire on every `prisma generate`.
#
# apps/backend/src/bypassAcl/ is also excluded: it's the one sanctioned location
# for raw calls (behind the rawQuery() wrapper in bypassAcl/base.ts, each site
# requiring tables/reason for auditability), enforced instead by
# scripts/validate-no-acl-bypass.sh (which blocks raw primitives OUTSIDE this
# folder) and by a CODEOWNERS requirement on the folder. Counting raw calls
# inside it would fight the framework the guard exists to push code toward.
EXCLUDED_RE='(^|/)(node_modules|dist|build|generated)/|(^|/)apps/backend/src/bypassAcl/'

# This script is the one file that must spell the guarded names out in full —
# it cannot be subject to its own rule. Nothing else is exempt.
SELF_PATH='scripts/validate-no-raw-sql.sh'

if [ -t 1 ]; then
    RED='\033[1;31m'; YELLOW='\033[1;33m'; GREEN='\033[1;32m'; RESET='\033[0m'
else
    RED=''; YELLOW=''; GREEN=''; RESET=''
fi

# BLANK OUT whole-line comments so a doc-block or a commented-out example
# doesn't count as a call: `//…`, `/*…`, `*…` continuation lines (TS/JS) and
# `#…` (shell, YAML, Dockerfile — the guard scans every file, and a workflow or
# hook that merely NAMES these APIs in a comment is not a call site).
#
# Blanking rather than deleting keeps line numbers intact, so the counting pass
# and the reporting pass see the same stream and report the same lines.
#
# Deliberately does NOT touch trailing comments on code lines — truncating at
# the first `//` would also truncate at the `//` in a URL string literal, which
# could HIDE a real call later on that line. Over-counting fails closed;
# under-counting would be a silent bypass.
#
# `#` is a comment only where it actually is one: in TS/JS a leading `#` is a
# private class field (`#rawQuery = …`), so blanking those lines there would be
# a silent bypass.
blank_comment_lines() {
    case "$1" in
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.mts|*.cts)
            awk '{ if ($0 ~ /^[[:space:]]*(\/\/|\/\*|\*)/) print ""; else print }' ;;
        *)
            awk '{ if ($0 ~ /^[[:space:]]*(\/\/|\/\*|\*|#)/) print ""; else print }' ;;
    esac
}

show_at() { git show "${1}${2}" 2>/dev/null || true; }

# The scanned stream for a path: file content at a git spec, comment lines blanked.
scan_stream() { show_at "$1" "$2" | blank_comment_lines "$2"; }

count_raw() {
    scan_stream "$1" "$2" | { grep -oaE "$RAW_RE" || true; } | wc -l | tr -d '[:space:]'
}

violations=0

while IFS=$'\t' read -r status p1 p2; do
    [ -z "${status:-}" ] && continue

    case "$status" in
        D*) continue ;;                             # deletion — nothing new to add
        R*|C*) old_path="$p1"; new_path="${p2:-$p1}" ;;
        *)  old_path="$p1"; new_path="$p1" ;;
    esac

    [ "$new_path" = "$SELF_PATH" ] && continue
    printf '%s' "$new_path" | grep -qE "$EXCLUDED_RE" && continue

    new_count=$(count_raw "$NEW_SPEC" "$new_path")
    [ "$new_count" = "0" ] && continue

    old_count=$(count_raw "$OLD_SPEC" "$old_path")
    [ "$new_count" -le "$old_count" ] && continue

    if [ "$violations" -eq 0 ]; then
        echo -e "${RED}❌ raw SQL guard: new \$queryRaw / \$executeRaw introduced in this diff${RESET}"
        echo ""
    fi
    violations=$((violations + 1))

    if [ "$old_path" != "$new_path" ]; then
        echo -e "  ${YELLOW}${new_path}${RESET}  (renamed from ${old_path}; ${old_count} raw call(s) before, ${new_count} now)"
    else
        echo -e "  ${YELLOW}${new_path}${RESET}  (${old_count} raw call(s) before, ${new_count} now)"
    fi
    scan_stream "$NEW_SPEC" "$new_path" | grep -naE "$RAW_RE" | sed 's/^/    /'
    echo ""
done < <(diff_status)

if [ "$violations" -gt 0 ]; then
    echo "\$queryRaw / \$executeRaw bypass the Prisma query builder and the tenant"
    echo "ACL + workspaceId-stamping extensions in apps/backend/src/database/tenant/ —"
    echo "a raw query is scoped to no workspace by anything. Use the query builder."
    echo ""
    echo "There is no escape-hatch comment and no allowlist. If the query genuinely"
    echo "cannot be expressed via the query builder, that needs a separate PR that"
    echo "amends scripts/validate-no-raw-sql.sh."
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ raw SQL guard: no new \$queryRaw / \$executeRaw in this diff.${RESET}"
exit 0
