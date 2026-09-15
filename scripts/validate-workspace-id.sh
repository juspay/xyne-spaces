#!/bin/bash

# New-Table Tenant-Scoping Guard
#
# When a brand new Prisma model (table) is added to schema.prisma, it must carry
# a non-nullable `workspaceId` or `orgId` scalar field. Tables without a tenant
# key are exactly the shape of bug this guard exists to catch: repositories and
# the ACL extension both key off workspaceId to enforce tenant isolation, so a
# table that never had the column can never be scoped, no matter how carefully
# the query code is written later.
#
# Only runs against genuinely NEW models (added in this diff) — existing models
# are untouched, so this never blocks unrelated schema edits.
#
# Escape hatch #1 (inline, per-model): a model that is intentionally global/cross-tenant
# (e.g. a shared lookup table) can opt out by placing `// workspace-check:ignore` on the
# line directly above `model X {`.
#
# Escape hatch #2 (list): add the model name to TENANT_KEY_EXCLUDED_MODELS in
# apps/backend/src/database/tenant/tenant-key-exclusions.ts instead. Same effect,
# centralized and reviewable in one diff instead of scattered comments — and it's the
# same list apps/backend/src/database/tenant/tenant-key-guard.test.ts checks against
# the FULL schema, so there is exactly one place to maintain exclusions, not two.
#
# Neither hatch excuses the model from tenant scoping in code — it only silences this
# shape check. The No-Default-ACL guard below (and the backend's exhaustive ACL-factory
# switches it protects) still forces an explicit, reviewed access-control decision
# (a real scoped ACL, or UnscopedACL) for every model, excluded or not.
#
# No-Default-ACL Guard
#
# The ACL factory switches (see ACL_FACTORY_PATHS below) must enumerate every
# table with an explicit `case`. A `default:` branch returning BaseQueryACL /
# BaseACL lets a brand-new table silently inherit generic base-class scoping
# without the author — or any reviewer — ever making a deliberate access
# decision for that table. There is no escape hatch for this one: remove the
# `default:` branch and add an explicit `case` per table (a purpose-built ACL
# class, or an explicit BaseQueryACL/UnscopedACL choice).

set -e

SCHEMA_PATHS=(
    "apps/backend/prisma/schema.prisma"
    "apps/xyne-claw-auth/backend/prisma/schema.prisma"
)

# Single source of truth for the exclusion list — same file the backend's
# tenant-key-guard.test.ts reads, so a table only needs to be listed once.
TENANT_KEY_EXCLUSIONS_TS="apps/backend/src/database/tenant/tenant-key-exclusions.ts"

# Parses the quoted model names out of the TENANT_KEY_EXCLUDED_MODELS array literal in
# TENANT_KEY_EXCLUSIONS_TS (plain text parsing, no TS/node dependency — this script only
# needs bash+git). Reads the staged version when available, so a staged edit to the
# exclusion list is honored immediately; falls back to the working-tree file otherwise.
load_excluded_models() {
    local ts_file="$1"
    [ -f "$ts_file" ] || return

    local content
    content=$(git show ":$ts_file" 2>/dev/null || cat "$ts_file" 2>/dev/null || echo "")

    echo "$content" | awk '
        /TENANT_KEY_EXCLUDED_MODELS/ { found=1 }
        found { print }
        found && /\];/ { exit }
    ' | sed -E 's#//.*$##' | grep -oE "'[^']*'" | sed -E "s/^'|'\$//g"
}

EXCLUDED_MODELS=()
while IFS= read -r model_name; do
    [ -n "$model_name" ] && EXCLUDED_MODELS+=("$model_name")
done < <(load_excluded_models "$TENANT_KEY_EXCLUSIONS_TS")

# ACL factory switches that must enumerate every table explicitly — a `default:`
# branch in any of these files is a blocking failure.
ACL_FACTORY_PATHS=(
    "apps/backend/src/database/acl/acl-factory.ts"
    "apps/backend/src/zero/acl/core/acl-factory.ts"
    "packages/shared/src/zero/acl/core/query-acl-factory.ts"
)

if [ -t 1 ]; then
    RED='\033[1;31m'
    GREEN='\033[1;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[1;34m'
    RESET='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    RESET=''
fi

log_info() { echo -e "${BLUE}ℹ️  $1${RESET}"; }
log_success() { echo -e "${GREEN}✅ $1${RESET}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${RESET}"; }
log_error() { echo -e "${RED}❌ $1${RESET}"; }

# Staged content of a schema file, so validation matches what's actually being committed.
get_schema_content() {
    local schema_file="$1"
    git show ":$schema_file" 2>/dev/null || cat "$schema_file" 2>/dev/null || echo ""
}

# Names of models that are newly added in the staged diff (not touched, not removed — added).
extract_new_models() {
    local schema_file="$1"
    git diff --cached -- "$schema_file" 2>/dev/null | \
        grep -E '^\+model[[:space:]]+[A-Za-z0-9_]+' | \
        sed -E 's/^\+model[[:space:]]+([A-Za-z0-9_]+).*/\1/' | \
        sort -u
}

# Whether the model name is listed in EXCLUDED_MODELS.
model_is_excluded() {
    local model_name="$1"
    local excluded
    for excluded in "${EXCLUDED_MODELS[@]}"; do
        [ "$excluded" = "$model_name" ] && { echo "yes"; return; }
    done
}

# Whether the model is annotated with the opt-out comment on the line before `model X {`.
model_opts_out() {
    local schema_file="$1"
    local model_name="$2"

    get_schema_content "$schema_file" | awk -v model_name="$model_name" '
        $1 == "model" && $2 == model_name {
            if (prev ~ /workspace-check:ignore/) { print "yes" }
            exit
        }
        { prev = $0 }
    '
}

# Print "present" / "nullable" / "missing" for the model'"'"'s workspaceId/orgId field.
check_model_tenant_key() {
    local schema_file="$1"
    local model_name="$2"

    get_schema_content "$schema_file" | awk -v model_name="$model_name" '
        $1 == "model" && $2 == model_name { in_model=1; next }
        in_model && /^[[:space:]]*}/ { exit }
        in_model && $1 ~ /^(workspaceId|orgId)$/ {
            if ($2 ~ /\?$/) {
                print "nullable:" $1
            } else {
                print "present:" $1
            }
            exit
        }
    '
}

validate_workspace_id() {
    local has_errors=false
    local checked_any=false

    for schema_file in "${SCHEMA_PATHS[@]}"; do
        [ -f "$schema_file" ] || continue

        if ! git diff --cached --name-only | grep -q "^${schema_file}$"; then
            continue
        fi

        local new_models
        new_models=$(extract_new_models "$schema_file")
        [ -z "$new_models" ] && continue

        checked_any=true
        log_info "New model(s) detected in $schema_file — checking for workspaceId/orgId..."

        while IFS= read -r model; do
            [ -z "$model" ] && continue

            if [ "$(model_is_excluded "$model")" = "yes" ]; then
                log_info "  ⏭ model '$model' is in EXCLUDED_MODELS — skipping"
                continue
            fi

            if [ "$(model_opts_out "$schema_file" "$model")" = "yes" ]; then
                log_info "  ⏭ model '$model' has workspace-check:ignore — skipping"
                continue
            fi

            local result
            result=$(check_model_tenant_key "$schema_file" "$model")

            case "$result" in
                present:*)
                    log_info "  ✓ model '$model' has non-nullable ${result#present:}"
                    ;;
                nullable:*)
                    has_errors=true
                    log_error "model '$model' has ${result#nullable:} but it is nullable (has '?') — must be non-nullable"
                    ;;
                *)
                    has_errors=true
                    log_error "model '$model' has no workspaceId or orgId field"
                    ;;
            esac
        done <<< "$new_models"
    done

    if [ "$checked_any" = false ]; then
        log_info "No new Prisma models in this commit. Skipping tenant-key check."
        return 0
    fi

    # Reminder (not enforced here): a new Zero table also needs a read-scope entry.
    echo ""
    log_warning "New table(s) detected — also classify each new Zero table in"
    log_warning "  apps/backend/src/zero/tenant-scope.ts:"
    log_warning "    • a table with a workspaceId column is auto-scoped (no change needed);"
    log_warning "    • otherwise add it to CUSTOM_SCOPES or GLOBAL_REFERENCE_TABLES,"
    log_warning "      or a Zero query against it is refused at runtime (zero_query_unscoped_table)."

    if [ "$has_errors" = true ]; then
        echo ""
        echo "New tables must carry a non-nullable tenant key:"
        echo "  Add a non-nullable 'workspaceId String' (or 'orgId String') field to the model."
        echo "  If the table is intentionally global/cross-tenant, either add the model name"
        echo "  to TENANT_KEY_EXCLUDED_MODELS in $TENANT_KEY_EXCLUSIONS_TS, or add"
        echo "  '// workspace-check:ignore' on the line directly above 'model X {'."
        echo ""
        return 1
    fi

    log_success "Tenant-key validation passed for new models."
    return 0
}

# Staged (or working-tree fallback) content of an arbitrary file, so the check
# matches what would actually be committed.
get_file_content() {
    local file="$1"
    git show ":$file" 2>/dev/null || cat "$file" 2>/dev/null || echo ""
}

# No-Default-ACL guard: the factory switches must list every table with an
# explicit `case`. A `default:` branch returning a base ACL means a new table
# gets generic scoping without anyone deliberately choosing its access rules.
validate_no_default_acl() {
    local has_errors=false

    for factory_file in "${ACL_FACTORY_PATHS[@]}"; do
        if [ ! -f "$factory_file" ]; then
            log_warning "$factory_file not found — skipping its default-branch check."
            continue
        fi

        local matches
        matches=$(get_file_content "$factory_file" | grep -nE '^[[:space:]]*default[[:space:]]*:' || true)

        if [ -n "$matches" ]; then
            has_errors=true
            log_error "$factory_file has a 'default:' branch in the ACL factory switch:"
            while IFS= read -r match; do
                echo "    ${match}"
            done <<< "$matches"
        fi
    done

    if [ "$has_errors" = true ]; then
        echo ""
        echo "ACL factory switches must enumerate every table explicitly:"
        echo "  Remove the 'default:' branch and add an explicit 'case' for each table"
        echo "  (a purpose-built ACL class, or an explicit BaseQueryACL/UnscopedACL choice),"
        echo "  so every table's access rule is a deliberate, reviewable decision."
        echo ""
        return 1
    fi

    log_success "No 'default:' branch found in ACL factory switches."
    return 0
}

# Skip validation if HUSKY=0 (for automated commits)
if [ "${HUSKY:-}" = "0" ]; then
    log_info "HUSKY=0 detected, skipping workspaceId/ACL-factory validation"
    exit 0
fi

failed_guards=()

log_info "━━━ Guard 1/2: tenant-key (workspaceId/orgId) on new models ━━━"
validate_workspace_id || failed_guards+=("workspaceId/orgId tenant-key check")

echo ""
log_info "━━━ Guard 2/2: no 'default:' branch in ACL factory switches ━━━"
validate_no_default_acl || failed_guards+=("no-default-ACL check")

if [ ${#failed_guards[@]} -gt 0 ]; then
    echo ""
    log_error "Guard(s) failed:"
    for guard in "${failed_guards[@]}"; do
        echo "  ❌ $guard"
    done
    echo ""
    echo "See the detailed error output above for each failed guard."
    exit 1
fi

exit 0
