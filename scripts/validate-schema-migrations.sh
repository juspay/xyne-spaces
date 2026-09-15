#!/bin/bash

# Schema-Migration Validation Script
# Ensures that database schema changes are accompanied by corresponding migration files
# with deep string-matching validation.
#
# Usage: ./validate-schema-migrations.sh [options]
#   --ci-mode: Run in CI mode (no interactive prompts, different error formatting)

set -e

# Parse arguments
CI_MODE=false
SCHEMA_PATHS=()
MIGRATIONS_DIRS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --ci-mode)
            CI_MODE=true
            shift
            ;;
        --schema-path)
            SCHEMA_PATHS+=("$2")
            shift 2
            ;;
        --migrations-dir)
            MIGRATIONS_DIRS+=("$2")
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Default configuration if not provided via CLI
if [ ${#SCHEMA_PATHS[@]} -eq 0 ]; then
    SCHEMA_PATHS=(
        "apps/backend/prisma/schema.prisma"
        "apps/xyne-claw-auth/backend/prisma/schema.prisma"
    )
fi

if [ ${#MIGRATIONS_DIRS[@]} -eq 0 ]; then
    MIGRATIONS_DIRS=(
        "apps/backend/prisma/migrations"
        "apps/xyne-claw-auth/backend/prisma/migrations"
    )
fi

# Colors for output (only in non-CI mode)
if [ "$CI_MODE" = false ] && [ -t 1 ]; then
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

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${RESET}"
}

log_success() {
    echo -e "${GREEN}✅ $1${RESET}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${RESET}"
}

log_error() {
    echo -e "${RED}❌ $1${RESET}"
}

# Extract new definitions (models or enums) from schema diff
# Arguments: $1 = schema_file, $2 = definition_type (model|enum)
# Returns: list of definition names (one per line)
extract_new_definitions() {
    local schema_file="$1"
    local definition_type="$2"
    local diff_output

    # Get the diff of staged changes for the schema file
    diff_output=$(git diff --cached "$schema_file" 2>/dev/null || true)

    if [ -z "$diff_output" ]; then
        return 0
    fi

    # Extract new definitions (lines starting with +<type>)
    # Filter out comment lines and extract just the name
    echo "$diff_output" | grep -E "^\\+${definition_type}[[:space:]]+[A-Za-z0-9_]+" | \
        sed -E "s/^\\+${definition_type}[[:space:]]+([A-Za-z0-9_]+).*/\\1/" | \
        sort -u
}



# Get staged migration files for a migrations directory
# Returns: list of migration file paths (one per line)
get_staged_migrations() {
    local migrations_dir="$1"
    git diff --cached --name-only | grep "^${migrations_dir}/" || true
}

# Get migration file content (handles both staged and unstaged files)
# Arguments: $1 = migration_file path
# Returns: file content via stdout
get_migration_content() {
    local migration_file="$1"
    # Use git show for staged files, fall back to cat for unstaged files
    git show ":$migration_file" 2>/dev/null || cat "$migration_file" 2>/dev/null || echo ""
}

# Get schema content from the index so validation matches the staged diff.
# Falls back to the working tree for callers using an unstaged schema fixture.
get_schema_content() {
    local schema_file="$1"
    git show ":$schema_file" 2>/dev/null || cat "$schema_file" 2>/dev/null || echo ""
}

# Resolve a Prisma model's mapped SQL table name, if it has an @@map annotation.
# Arguments: $1 = schema_file, $2 = model_name
get_mapped_model_name() {
    local schema_file="$1"
    local model_name="$2"

    get_schema_content "$schema_file" | awk -v model_name="$model_name" '
        $1 == "model" && $2 == model_name { in_model=1; next }
        in_model && /@@map[[:space:]]*\("[^"]+"\)/ {
            mapped_name=$0
            sub(/^.*@@map[[:space:]]*\("/, "", mapped_name)
            sub(/"\).*$/, "", mapped_name)
            print mapped_name
            exit
        }
        in_model && /^[[:space:]]*}/ { exit }
    '
}

# Check if a model/enum name exists in migration files
# For models with @@map, also check the mapped SQL table name.
# Arguments: $1 = identifier, $2 = schema_file, $3 = definition_type, remaining = migration files
# Returns: 0 if found, 1 if not found
identifier_in_migrations() {
    local identifier="$1"
    local schema_file="$2"
    local definition_type="$3"
    shift 3
    local migration_files=("$@")
    local mapped_identifier=""

    if [ "$definition_type" = "model" ]; then
        mapped_identifier=$(get_mapped_model_name "$schema_file" "$identifier")
    fi

    for migration_file in "${migration_files[@]}"; do
        # Check if migration file contains the identifier (case-insensitive)
        # Use get_migration_content to handle both staged and unstaged files
        if get_migration_content "$migration_file" | grep -qi "\b${identifier}\b"; then
            return 0
        fi

        # Prisma migration SQL uses the mapped table name rather than the model name.
        if [ -n "$mapped_identifier" ] && \
            get_migration_content "$migration_file" | grep -qiF -- "$mapped_identifier"; then
            return 0
        fi
    done

    return 1
}

# Get the SQL content from a migration file (for debugging)
get_migration_content_preview() {
    local migration_file="$1"
    get_migration_content "$migration_file" | head -20 || echo "(unable to read file)"
}

# Extract names of models/enums annotated with @@schema("non_zero") from a schema file.
# Definitions in the "non_zero" Postgres schema are intentionally NOT replicated to Zero,
# so they must be exempt from the Prisma<>Zero sync check.
# Arguments: $1 = schema_file, $2 = definition_type (model|enum)
# Returns: list of definition names (one per line)
get_non_zero_definitions() {
    local schema_file="$1"
    local definition_type="$2"

    [ -f "$schema_file" ] || return 0

    awk -v type="$definition_type" '
        $0 ~ "^"type"[[:space:]]+[A-Za-z0-9_]+" { name=$2; in_block=1 }
        in_block && /@@schema\("non_zero"\)/ { print name }
        /^}/ { in_block=0; name="" }
    ' "$schema_file"
}

# Extract Prisma models explicitly excluded from the Zero generator.
# These backend-only tables should not be required in the shared Zero schema.
get_zero_excluded_models() {
    local schema_file="$1"

    get_schema_content "$schema_file" | awk '
        $1 == "generator" && $2 == "zero" { in_generator=1; next }
        in_generator && /^[[:space:]]*}/ { exit }
        in_generator && /excludeTables[[:space:]]*=/ {
            line=$0
            while (match(line, /"[^"]+"/)) {
                model=substr(line, RSTART + 1, RLENGTH - 2)
                print model
                line=substr(line, RSTART + RLENGTH)
            }
        }
    '
}

# Check if a name is present in a newline-separated list.
# Arguments: $1 = name, $2 = list
in_list() {
    local needle="$1"
    local haystack="$2"
    [ -n "$needle" ] && grep -qxF "$needle" <<< "$haystack"
}

# Validate that new models/enums added to schema.prisma are also reflected in packages/shared/src/zero/schema.ts
# This enforces that any Prisma schema change is manually synced to the Zero TS schema
validate_prisma_zero_sync() {
    local prisma_schema="apps/backend/prisma/schema.prisma"
    local zero_schema="packages/shared/src/zero/schema.ts"
    local has_errors=false

    # Only run this check if schema.prisma was changed
    if ! git diff --cached --name-only | grep -q "^${prisma_schema}$"; then
        return 0
    fi

    # Check if zero schema file exists
    if [ ! -f "$zero_schema" ]; then
        log_warning "$zero_schema not found — skipping Prisma<>Zero sync check."
        return 0
    fi

    log_info "Checking Prisma<>Zero schema sync (schema.prisma → schema.ts)..."

    # Definitions in the "non_zero" Postgres schema are not replicated to Zero and
    # must be excluded from the sync requirement.
    local non_zero_models
    non_zero_models=$(get_non_zero_definitions "$prisma_schema" "model")
    local non_zero_enums
    non_zero_enums=$(get_non_zero_definitions "$prisma_schema" "enum")
    local zero_excluded_models
    zero_excluded_models=$(get_zero_excluded_models "$prisma_schema")

    # Extract newly added Prisma model names from the staged diff
    local new_prisma_models
    new_prisma_models=$(git diff --cached -- "$prisma_schema" 2>/dev/null | \
        grep -E '^\+model[[:space:]]+[A-Za-z0-9_]+' | \
        sed -E 's/^\+model[[:space:]]+([A-Za-z0-9_]+).*/\1/' | \
        sort -u || true)

    # Extract newly added Prisma enum names from the staged diff
    local new_prisma_enums
    new_prisma_enums=$(git diff --cached -- "$prisma_schema" 2>/dev/null | \
        grep -E '^\+enum[[:space:]]+[A-Za-z0-9_]+' | \
        sed -E 's/^\+enum[[:space:]]+([A-Za-z0-9_]+).*/\1/' | \
        sort -u || true)

    # For each new Prisma model, verify it exists as a table() in schema.ts
    if [ -n "$new_prisma_models" ]; then
        while IFS= read -r model; do
            [ -z "$model" ] && continue
            # Skip models that live in the "non_zero" schema — they are not synced to Zero.
            if in_list "$model" "$non_zero_models"; then
                log_info "  ⏭ Prisma model '$model' is in the non_zero schema — skipping Zero sync check"
                continue
            fi
            if in_list "$model" "$zero_excluded_models"; then
                log_info "  ⏭ Prisma model '$model' is excluded from the Zero generator — skipping Zero sync check"
                continue
            fi
            # Match the PascalCase model name or its @@map'd snake_case table name.
            local mapped_table
            mapped_table=$(get_mapped_model_name "$prisma_schema" "$model")
            if grep -qi "table(.*${model}" "$zero_schema" || \
               { [ -n "$mapped_table" ] && grep -qiE "table\([\"']${mapped_table}[\"']" "$zero_schema"; }; then
                log_info "  ✓ Prisma model '$model' found in $zero_schema"
            else
                log_error "Prisma model '$model' added to schema.prisma but no matching table() found in $zero_schema"
                log_error "  → Add a corresponding table definition in $zero_schema"
                has_errors=true
            fi
        done <<< "$new_prisma_models"
    fi

    # For each new Prisma enum, verify it exists as an enum in schema.ts
    if [ -n "$new_prisma_enums" ]; then
        while IFS= read -r enum_name; do
            [ -z "$enum_name" ] && continue
            # Skip enums that live in the "non_zero" schema — they are not synced to Zero.
            if in_list "$enum_name" "$non_zero_enums"; then
                log_info "  ⏭ Prisma enum '$enum_name' is in the non_zero schema — skipping Zero sync check"
                continue
            fi
            if ! grep -qi "export enum ${enum_name}" "$zero_schema"; then
                log_error "Prisma enum '$enum_name' added to schema.prisma but not found in $zero_schema"
                log_error "  → Add a corresponding enum definition in $zero_schema"
                has_errors=true
            else
                log_info "  ✓ Prisma enum '$enum_name' found in $zero_schema"
            fi
        done <<< "$new_prisma_enums"
    fi

    if [ "$has_errors" = true ]; then
        echo ""
        echo "Zero schema sync is required:"
        echo "  When adding new models or enums to schema.prisma, you must also"
        echo "  add the corresponding definitions to $zero_schema"
        echo ""
        return 1
    fi

    return 0
}

# Main validation function
validate_schema_migrations() {
    local found_schema_change=false
    local all_new_models=()
    local model_schema_files=()
    local all_new_enums=()
    local all_staged_migrations=()
    local schema_to_migrations_map=()

    log_info "Checking for schema changes..."

    # Check each schema file
    for i in "${!SCHEMA_PATHS[@]}"; do
        local schema_file="${SCHEMA_PATHS[$i]}"
        local migrations_dir="${MIGRATIONS_DIRS[$i]}"
        
        # Skip if migrations_dir not defined for this schema
        if [ -z "$migrations_dir" ]; then
            continue
        fi

        # Check if schema file exists and is staged
        if [ ! -f "$schema_file" ]; then
            continue
        fi

        # Check if schema file is staged for commit
        if ! git diff --cached --name-only | grep -q "^${schema_file}$"; then
            continue
        fi

        found_schema_change=true
        log_info "Schema changes detected in: $schema_file"

        # Extract new models and enums
        local new_models
        new_models=$(extract_new_definitions "$schema_file" "model")

        local new_enums
        new_enums=$(extract_new_definitions "$schema_file" "enum")

        # Get staged migrations for this schema
        local staged_migrations
        staged_migrations=$(get_staged_migrations "$migrations_dir")

        # Store results
        if [ -n "$new_models" ]; then
            while IFS= read -r model; do
                if [ -n "$model" ]; then
                    all_new_models+=("$model")
                    model_schema_files+=("$schema_file")
                fi
            done <<< "$new_models"
        fi

        if [ -n "$new_enums" ]; then
            while IFS= read -r enum; do
                [ -n "$enum" ] && all_new_enums+=("$enum")
            done <<< "$new_enums"
        fi



        if [ -n "$staged_migrations" ]; then
            while IFS= read -r migration; do
                [ -n "$migration" ] && all_staged_migrations+=("$migration")
            done <<< "$staged_migrations"
        fi

        # Map this schema to its migrations
        schema_to_migrations_map+=("$schema_file:$migrations_dir")
    done

    # If no schema changes, nothing to validate
    if [ "$found_schema_change" = false ]; then
        log_info "No schema changes detected. Skipping migration validation."
        return 0
    fi

    # Check if any migrations are staged
    if [ ${#all_staged_migrations[@]} -eq 0 ]; then
        log_error "Schema file(s) changed but no migration files staged!"
        echo ""
        echo "You must create and stage migration files when modifying the Prisma schema."
        echo "Run: pnpm exec prisma migrate dev --name <descriptive_name>"
        echo ""
        return 1
    fi

    log_info "Found ${#all_staged_migrations[@]} staged migration file(s)"

    # Validate new models
    local missing_models=()
    for i in "${!all_new_models[@]}"; do
        local model="${all_new_models[$i]}"
        local model_schema="${model_schema_files[$i]}"
        if ! identifier_in_migrations "$model" "$model_schema" "model" "${all_staged_migrations[@]}"; then
            missing_models+=("$model")
        fi
    done

    # Validate new enums
    local missing_enums=()
    for enum in "${all_new_enums[@]}"; do
        if ! identifier_in_migrations "$enum" "" "enum" "${all_staged_migrations[@]}"; then
            missing_enums+=("$enum")
        fi
    done

    # Report results
    local has_errors=false

    if [ ${#missing_models[@]} -gt 0 ]; then
        has_errors=true
        log_error "The following models were added to schema but not found in migrations:"
        for model in "${missing_models[@]}"; do
            echo "  - $model"
        done
    fi

    if [ ${#missing_enums[@]} -gt 0 ]; then
        has_errors=true
        log_error "The following enums were added to schema but not found in migrations:"
        for enum in "${missing_enums[@]}"; do
            echo "  - $enum"
        done
    fi

    if [ "$has_errors" = true ]; then
        echo ""
        echo "Staged migration files checked:"
        for migration in "${all_staged_migrations[@]}"; do
            echo "  - $migration"
        done
        echo ""
        echo "To fix this issue:"
        echo "1. Ensure your migration file contains SQL for the new models/enums"
        echo "2. Run: pnpm exec prisma migrate dev --name <descriptive_name>"
        echo "3. Stage the generated migration files"
        echo ""
        return 1
    fi

    log_success "Schema-migration validation passed!"

    if [ ${#all_new_models[@]} -gt 0 ]; then
        echo "   New models validated: ${all_new_models[*]}"
    fi

    if [ ${#all_new_enums[@]} -gt 0 ]; then
        echo "   New enums validated: ${all_new_enums[*]}"
    fi

    return 0
}

# Skip validation if HUSKY=0 (for automated commits)
if [ "${HUSKY:-}" = "0" ]; then
    log_info "HUSKY=0 detected, skipping schema-migration validation"
    exit 0
fi

# Run migration validation
if ! validate_schema_migrations; then
    exit 1
fi

# Run Prisma<>Zero schema sync check
if ! validate_prisma_zero_sync; then
    exit 1
fi

exit 0
