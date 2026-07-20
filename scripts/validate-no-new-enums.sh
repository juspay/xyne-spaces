#!/bin/bash

# Enum Guard (XYNE-16525 enum -> TEXT migration)
# ---------------------------------------------
# Postgres enums are FROZEN. This blocks three things in a commit / PR:
#   1) a new `enum` block added to the Prisma schema
#   2) a new VALUE added to an existing enum block
#   3) `CREATE TYPE` / `ALTER TYPE` in a migration .sql file
#
# Why: an enum column needs `ALTER TYPE ... ADD VALUE` for every new value — the
# migration cost we are eliminating. A new value must instead be a plain `String`
# column + app-side validation, with ZERO DB migration. (DROP TYPE is allowed —
# that's the cleanup direction.)
#
# It compares the OLD vs NEW parsed enum sets (not raw diff lines), so moving or
# re-indenting an existing enum block does NOT false-fire, and value additions
# inside a block are caught.
#
# Usage:
#   scripts/validate-no-new-enums.sh              # staged changes (pre-commit)
#   scripts/validate-no-new-enums.sh --base <ref> # <ref>..HEAD (explicit base)
#   scripts/validate-no-new-enums.sh --ci         # CI: auto-resolve base branch
#                                                 #   merge-base ($CHANGE_TARGET/main),
#                                                 #   incl. shallow-clone fetch fallback
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
                echo "❌ enum guard: --base requires a ref argument" >&2
                exit 2
            fi
            shift 2
            ;;
        --ci)
            CI_MODE=1
            shift
            ;;
        *)
            echo "❌ enum guard: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

# --ci: resolve the base-branch merge-base ourselves so callers (Jenkins) stay a
# single line. Uses $CHANGE_TARGET (the PR target branch) or falls back to main,
# and handles shallow PR clones that lack the base ref / merge-base.
if [ "$CI_MODE" = "1" ]; then
    if [ -n "$BASE_REF" ]; then
        echo "❌ enum guard: pass either --ci or --base, not both" >&2
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
    echo "enum guard (--ci): diffing against ${BASE_REF}"
fi

# Resolve OLD/NEW sources. In --base mode the base MUST resolve to a real commit,
# otherwise we refuse to run (a guard that can't find its baseline must fail loud,
# never pass vacuously green).
if [ -n "$BASE_REF" ]; then
    if ! git rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null 2>&1; then
        echo "❌ enum guard: base ref '${BASE_REF}' does not resolve to a commit." >&2
        echo "   Refusing to run — this would otherwise check nothing and pass green." >&2
        exit 2
    fi
    OLD_SPEC="${BASE_REF}:"
    NEW_SPEC="HEAD:"
    diff_names() { git diff --name-only "${BASE_REF}...HEAD"; }
else
    OLD_SPEC="HEAD:"
    NEW_SPEC=":" # the index (staged)
    diff_names() { git diff --cached --name-only; }
fi

# Prisma schema file(s) to guard. (Intentionally NOT xyne-claw-auth — the freeze
# does not apply there.)
SCHEMA_FILES=(
    "backend/prisma/schema.prisma"
)

if [ -t 1 ]; then
    RED='\033[1;31m'; YELLOW='\033[1;33m'; GREEN='\033[1;32m'; RESET='\033[0m'
else
    RED=''; YELLOW=''; GREEN=''; RESET=''
fi

# Parse a Prisma schema on stdin -> "EnumName:VALUE" per enum value.
# Tolerates leading whitespace, trailing comments, and value @attributes.
enum_values() {
    awk '
        $1=="enum" && $2 ~ /^[A-Za-z0-9_]+\{?$/ { inenum=1; name=$2; sub(/\{.*/,"",name); next }
        inenum && $1=="}" { inenum=0; next }
        inenum {
            v=$1
            if (v ~ /^@/)   next   # @@schema / @map etc
            if (v ~ /^\//)  next   # // comment
            if (v=="{" || v=="") next
            print name ":" v
        }
    '
}

# Normalize a .sql stream and print any statement that STARTS with CREATE/ALTER
# TYPE. Strips line comments, joins lines, splits on ';' -> catches chained and
# multi-line forms. `ALTER TABLE ... TYPE text` is NOT matched (starts ALTER TABLE).
# NOTE: '--' comment stripping is naive w.r.t. string literals; a literal
# containing '--' or DDL-lookalike text can only cause a FALSE POSITIVE
# (fail closed) — real DDL after '--' would be a comment, i.e. not DDL at all.
sql_type_ddl() {
    sed 's/--.*$//' \
      | tr '\n' ' ' \
      | tr ';' '\n' \
      | sed -E 's/^[[:space:]]+//' \
      | grep -iE '^(create|alter)[[:space:]]+type[[:space:]]' || true
}

show_at() { git show "${1}${2}" 2>/dev/null || true; }

violations=0

# --- Check 1 & 2: new enum blocks / new enum values --------------------------
for schema in "${SCHEMA_FILES[@]}"; do
    old_vals=$(show_at "$OLD_SPEC" "$schema" | enum_values | sort -u)
    new_vals=$(show_at "$NEW_SPEC" "$schema" | enum_values | sort -u)

    added=$(comm -13 <(printf '%s\n' "$old_vals") <(printf '%s\n' "$new_vals") || true)
    [ -z "$added" ] && continue

    old_enums=$(printf '%s\n' "$old_vals" | sed -E 's/:.*//' | sort -u)

    msgs=$(while IFS= read -r line; do
        [ -z "$line" ] && continue
        en="${line%%:*}"; val="${line#*:}"
        if printf '%s\n' "$old_enums" | grep -qxF "$en"; then
            echo "new value '$val' added to existing enum '$en'"
        else
            echo "new enum '$en'"
        fi
    done <<< "$added" | sort -u)

    if [ -n "$msgs" ]; then
        echo -e "${RED}❌ Enum change in ${schema}:${RESET}"
        while IFS= read -r m; do [ -n "$m" ] && echo "     - $m"; done <<< "$msgs"
        violations=1
    fi
done

# --- Check 3: no CREATE TYPE / ALTER TYPE in migration .sql -------------------
# Scoped to the guarded backend only — xyne-claw-auth's migrations are exempt,
# matching SCHEMA_FILES above.
migration_sqls=$(diff_names | grep -E '^backend/prisma/migrations/.*\.sql$' || true)
if [ -n "$migration_sqls" ]; then
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        hits=$(show_at "$NEW_SPEC" "$f" | sql_type_ddl)
        if [ -n "$hits" ]; then
            echo -e "${RED}❌ Forbidden enum DDL in ${f}:${RESET}"
            while IFS= read -r line; do [ -n "$line" ] && echo "     ${line}"; done <<< "$hits"
            violations=1
        fi
    done <<< "$migration_sqls"
fi

if [ "$violations" -ne 0 ]; then
    echo ""
    echo -e "${YELLOW}DB enums are frozen.${RESET}"
    echo "  • Don't add a new 'enum' block, and don't add a value to an existing enum."
    echo "    Use a plain 'String' column + app-side validation instead of a DB enum."
    echo "  • Don't use CREATE TYPE / ALTER TYPE in a migration — a new value must need"
    echo "    zero DB migration."
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ enum guard passed (no new enums / values / enum DDL)${RESET}"
exit 0
