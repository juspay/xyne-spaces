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
# Escape hatch: a model that is intentionally global/cross-tenant (e.g. a shared
# lookup table) can opt out by placing `// workspace-check:ignore` on the line
# directly above `model X {`.

set -e

SCHEMA_PATHS=(
    "apps/backend/prisma/schema.prisma"
    "apps/xyne-claw-auth/backend/prisma/schema.prisma"
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

    if [ "$has_errors" = true ]; then
        echo ""
        echo "New tables must carry a non-nullable tenant key:"
        echo "  Add a non-nullable 'workspaceId String' (or 'orgId String') field to the model."
        echo "  If the table is intentionally global/cross-tenant, add"
        echo "  '// workspace-check:ignore' on the line directly above 'model X {'."
        echo ""
        return 1
    fi

    log_success "Tenant-key validation passed for new models."
    return 0
}

# Skip validation if HUSKY=0 (for automated commits)
if [ "${HUSKY:-}" = "0" ]; then
    log_info "HUSKY=0 detected, skipping workspaceId validation"
    exit 0
fi

if ! validate_workspace_id; then
    exit 1
fi

exit 0
