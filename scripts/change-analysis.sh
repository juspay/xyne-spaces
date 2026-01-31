#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS_FILE="$SCRIPT_DIR/patterns.sh"
JUSTIFICATIONS_FILE=".git/SERVICE_JUSTIFICATIONS"

# Cleanup function
cleanup() {
    rm -f "$JUSTIFICATIONS_FILE"
}

# Handle interrupt (Ctrl+C) - ensure clean exit
handle_interrupt() {
    echo -e "\n\033[1;31mCommit aborted by user.\033[0m"
    cleanup
    exit 1
}

# Trap signals - INT for Ctrl+C, TERM for termination
trap handle_interrupt INT TERM

# Source the patterns file
if [ -f "$PATTERNS_FILE" ]; then
    source "$PATTERNS_FILE"
else
    echo -e "\033[1;31mError: $PATTERNS_FILE not found.\033[0m"
    exit 1
fi

# Get STAGED files (not committed yet)
CHANGED_FILES=$(git diff --cached --name-only)

if [ -z "$CHANGED_FILES" ]; then
    echo "No staged changes detected."
    exit 0
fi

# Arrays to track services
SERVICES_WITH_MIGRATIONS=()
SERVICES_WITH_ENV_CHANGES=()
SERVICES_REQUIRING_REDEPLOYMENT=()

# Function to check if file matches a pattern
matches_pattern() {
    local file=$1
    local pattern=$2

    if [[ "$pattern" == */ ]]; then
        # Directory pattern: match if file starts with this path
        [[ "$file" == "$pattern"* ]] && return 0
    elif [[ "$pattern" == .* ]] && [[ "$pattern" != */ ]]; then
        # Hidden file pattern: match exact filename
        local filename=$(basename "$file")
        [[ "$filename" == "$pattern" ]] && return 0
    elif [[ "$pattern" == env.ts ]]; then
        # Special case: env.ts - match exact filename
        local filename=$(basename "$file")
        [[ "$filename" == "$pattern" ]] && return 0
    elif [[ "$pattern" == *.prisma ]]; then
        # Prisma files: first try exact match, then filename match
        [[ "$file" == "$pattern" ]] && return 0
        local filename=$(basename "$file")
        [[ "$filename" == "$pattern" ]] && return 0
    else
        # Other patterns: substring match
        [[ "$file" == *"$pattern"* ]] && return 0
    fi
    return 1
}

# Analyze staged files
while IFS= read -r file; do
    [ -z "$file" ] && continue

    # Check ignore patterns
    ignored=false
    for pattern in "${IGNORE_PATTERNS[@]}"; do
        if matches_pattern "$file" "$pattern"; then
            ignored=true
            break
        fi
    done
    [ "$ignored" = true ] && continue

    # Check if file is a migration change
    is_migration=false
    for pattern in "${MIGRATION_PATTERNS[@]}"; do
        if matches_pattern "$file" "$pattern"; then
            is_migration=true
            break
        fi
    done

    # Check if file is an env change
    is_env=false
    for pattern in "${ENV_PATTERNS[@]}"; do
        if matches_pattern "$file" "$pattern"; then
            is_env=true
            break
        fi
    done

    # Map to services
    for map_entry in "${SERVICE_MAPPINGS[@]}"; do
        pattern="${map_entry%%:*}"
        service="${map_entry#*:}"
        if [[ "$file" == "$pattern"* ]]; then
            if [ "$is_migration" = true ]; then
                # Add to migration list if not already present
                if [[ ! " ${SERVICES_WITH_MIGRATIONS[*]} " =~ " ${service} " ]]; then
                    SERVICES_WITH_MIGRATIONS+=("$service")
                fi
            elif [ "$is_env" = true ]; then
                # Add to env changes list if not already present
                if [[ ! " ${SERVICES_WITH_ENV_CHANGES[*]} " =~ " ${service} " ]]; then
                    SERVICES_WITH_ENV_CHANGES+=("$service")
                fi
            else
                # Add to redeployment list if not already present
                if [[ ! " ${SERVICES_REQUIRING_REDEPLOYMENT[*]} " =~ " ${service} " ]]; then
                    SERVICES_REQUIRING_REDEPLOYMENT+=("$service")
                fi
            fi
        fi
    done
done <<< "$CHANGED_FILES"

# Combine all services that need redeployment (including those with migration/env changes)
ALL_REDEPLOYMENT_SERVICES=("${SERVICES_REQUIRING_REDEPLOYMENT[@]}")

# Add services with migrations
for svc in "${SERVICES_WITH_MIGRATIONS[@]}"; do
    if [[ ! " ${ALL_REDEPLOYMENT_SERVICES[*]} " =~ " ${svc} " ]]; then
        ALL_REDEPLOYMENT_SERVICES+=("$svc")
    fi
done

# Add services with env changes
for svc in "${SERVICES_WITH_ENV_CHANGES[@]}"; do
    if [[ ! " ${ALL_REDEPLOYMENT_SERVICES[*]} " =~ " ${svc} " ]]; then
        ALL_REDEPLOYMENT_SERVICES+=("$svc")
    fi
done

# Check if there are any service impacts
if [ ${#SERVICES_WITH_MIGRATIONS[@]} -eq 0 ] && [ ${#SERVICES_WITH_ENV_CHANGES[@]} -eq 0 ] && [ ${#ALL_REDEPLOYMENT_SERVICES[@]} -eq 0 ]; then
    echo "No service-impacting changes detected."
    exit 0
fi

# Display service impacts
echo -e "\n\033[1;33mService Impact Detected:\033[0m"

if [ ${#SERVICES_WITH_MIGRATIONS[@]} -gt 0 ]; then
    echo -e "\033[1;31m Migration changes detected\033[0m"
fi

if [ ${#SERVICES_WITH_ENV_CHANGES[@]} -gt 0 ]; then
    echo -e "\033[1;31m Environment changes detected\033[0m"
fi

if [ ${#ALL_REDEPLOYMENT_SERVICES[@]} -gt 0 ]; then
    echo -e "\033[1;33mServices requiring redeployment:\033[0m"
    for svc in "${ALL_REDEPLOYMENT_SERVICES[@]}"; do echo "  - $svc"; done
fi

echo ""

if [ -e /dev/tty ]; then
    # Initialize the justifications file
    echo "" > "$JUSTIFICATIONS_FILE"
    echo "" >> "$JUSTIFICATIONS_FILE"

    # Prompt for migration justification
    if [ ${#SERVICES_WITH_MIGRATIONS[@]} -gt 0 ]; then
        echo "Migration-Changes:" >> "$JUSTIFICATIONS_FILE"
        while true; do
            read -p $'\033[1mPlease explain your migration changes (Ctrl+C to abort): \033[0m' justification < /dev/tty
            if [ -n "$justification" ]; then
                echo "  - $justification" >> "$JUSTIFICATIONS_FILE"
                echo -e "\033[1;32m Migration explanation accepted\033[0m"
                break
            else
                echo "Explanation cannot be empty."
            fi
        done
    fi

    # Prompt for env justification
    if [ ${#SERVICES_WITH_ENV_CHANGES[@]} -gt 0 ]; then
        echo "" >> "$JUSTIFICATIONS_FILE"
        echo "Environment-Changes:" >> "$JUSTIFICATIONS_FILE"
        
        # Ask for number of env vars changed
        while true; do
            read -p $'\033[1mHow many environment variables did you change? \033[0m' env_count < /dev/tty
            if [[ "$env_count" =~ ^[1-9][0-9]*$ ]]; then
                break
            else
                echo -e "\033[1;31mPlease enter a valid positive number.\033[0m"
            fi
        done
        
        # Loop for each env var
        for ((i=1; i<=env_count; i++)); do
            while true; do
                echo -e "\033[1mEnvironment variable $i of $env_count (Ctrl+C to abort):\033[0m"
                read -p $'\033[1;36mFormat: <ENV_VAR_NAME>: <explanation>\n> \033[0m' justification < /dev/tty
                if [ -z "$justification" ]; then
                    echo -e "\033[1;31mExplanation cannot be empty.\033[0m"
                elif [[ ! "$justification" =~ ^[A-Z][A-Z0-9_]*:\ .+ ]]; then
                    echo -e "\033[1;31mInvalid format. Please use: ENV_VAR_NAME: explanation\033[0m"
                    echo -e "\033[0;37mExample: LIVEKIT_URL: Added for WebRTC room connection\033[0m"
                else
                    echo "  - $justification" >> "$JUSTIFICATIONS_FILE"
                    echo -e "\033[1;32m Environment explanation $i accepted\033[0m"
                    break
                fi
            done
        done
    fi

    # Add redeployment services without prompting
    if [ ${#ALL_REDEPLOYMENT_SERVICES[@]} -gt 0 ]; then
        echo "" >> "$JUSTIFICATIONS_FILE"
        echo "Services-Requiring-Redeployment:" >> "$JUSTIFICATIONS_FILE"
        for svc in "${ALL_REDEPLOYMENT_SERVICES[@]}"; do
            echo "  - $svc" >> "$JUSTIFICATIONS_FILE"
        done
    fi

    echo -e "\n Service impact will be added to commit message"
    exit 0
else
    echo "No terminal available. Proceeding without justification prompt."
    exit 0
fi
