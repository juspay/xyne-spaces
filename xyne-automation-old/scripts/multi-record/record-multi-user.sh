#!/bin/bash

# Multi-User Playwright Live Recorder
# Opens multiple browser windows simultaneously, records all interactions
# from all windows in sequence into a single spec file.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${CYAN}=========================================="
echo -e "  Multi-User Live Recorder"
echo -e "==========================================${NC}"
echo ""
echo -e "${YELLOW}This will open multiple browser windows side by side.${NC}"
echo -e "${YELLOW}All interactions from all windows are recorded in sequence${NC}"
echo -e "${YELLOW}into a single spec file in tests/actions/.${NC}"
echo ""

cd "$AUTOMATION_DIR"

# ── Detect available browser configurations ──
# Look for browser definitions in setup features, browser.steps.ts, and fixture files
AVAILABLE_BROWSERS=()

# Check setup feature files for browser names in Examples tables
SETUP_FEATURES=$(find "$AUTOMATION_DIR/tests" -name "*setup*.feature" -type f 2>/dev/null)
for sf in $SETUP_FEATURES; do
    while IFS= read -r browser; do
        [ -z "$browser" ] && continue
        AVAILABLE_BROWSERS+=("$browser")
    done <<< "$(grep -oE '[a-zA-Z0-9_]+-browser' "$sf" 2>/dev/null | sort -u)"
done

# Also check all feature files for 'Given using browser "xxx"' or 'Given a browser "xxx"'
while IFS= read -r browser; do
    [ -z "$browser" ] && continue
    AVAILABLE_BROWSERS+=("$browser")
done <<< "$(grep -rhoE '"[a-zA-Z0-9_]+-browser"' "$AUTOMATION_DIR/tests/" --include="*.feature" 2>/dev/null | tr -d '"' | sort -u)"

# Check browser.steps.ts for registered browser names
BROWSER_STEPS_FILE="$AUTOMATION_DIR/tests/shared/browser.steps.ts"
if [ -f "$BROWSER_STEPS_FILE" ]; then
    while IFS= read -r browser; do
        [ -z "$browser" ] && continue
        AVAILABLE_BROWSERS+=("$browser")
    done <<< "$(grep -oE '"[a-zA-Z0-9_-]+-browser"' "$BROWSER_STEPS_FILE" 2>/dev/null | tr -d '"' | sort -u)"
fi

# Fallback: check fixtures for browser definitions
if [ ${#AVAILABLE_BROWSERS[@]} -eq 0 ]; then
    for f in "$AUTOMATION_DIR/fixtures/"*.ts "$AUTOMATION_DIR/fixtures/"*.js; do
        [ -f "$f" ] || continue
        while IFS= read -r browser; do
            [ -z "$browser" ] && continue
            AVAILABLE_BROWSERS+=("$browser")
        done <<< "$(grep -oE '"[a-zA-Z0-9_-]+-browser"' "$f" 2>/dev/null | tr -d '"' | sort -u)"
    done
fi

# Deduplicate and filter to only admin-browser and userN-browser patterns
if [ ${#AVAILABLE_BROWSERS[@]} -gt 0 ]; then
    AVAILABLE_BROWSERS=($(printf '%s\n' "${AVAILABLE_BROWSERS[@]}" | grep -E '^(admin-browser|user[0-9]+-browser)$' | sort -u))
fi

# Default known browsers if detection found nothing
if [ ${#AVAILABLE_BROWSERS[@]} -eq 0 ]; then
    AVAILABLE_BROWSERS=("admin-browser" "user2-browser" "user3-browser")
fi

MAX_BROWSERS=${#AVAILABLE_BROWSERS[@]}

# ── Display available browsers ──
echo -e "${CYAN}ℹ Available browser instances (${MAX_BROWSERS}):${NC}"
for i in "${!AVAILABLE_BROWSERS[@]}"; do
    echo -e "  ${GREEN}$((i+1)).${NC} ${AVAILABLE_BROWSERS[$i]}"
done
echo ""

# ── Parse user count from args (if --users N is passed) ──
REQUESTED_USERS=""
PASSTHROUGH_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --users|-u)
            REQUESTED_USERS="$2"
            PASSTHROUGH_ARGS+=("$1" "$2")
            shift 2
            ;;
        *)
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
    esac
done

# ── Validate requested user count ──
if [ -n "$REQUESTED_USERS" ]; then
    if [ "$REQUESTED_USERS" -gt "$MAX_BROWSERS" ] 2>/dev/null; then
        echo -e "${RED}⚠ Requested ${REQUESTED_USERS} users, but only ${MAX_BROWSERS} browser instances are configured.${NC}"
        echo ""
        echo -e "${YELLOW}Available browsers:${NC}"
        for b in "${AVAILABLE_BROWSERS[@]}"; do
            echo -e "  ${GREEN}•${NC} $b"
        done
        echo ""
        echo -e "${YELLOW}Browsers beyond ${MAX_BROWSERS} will NOT have matching step definitions in the setup feature.${NC}"
        echo -e "${YELLOW}You will need to manually add them before tests can run.${NC}"
        echo ""
        echo -e "${YELLOW}To add more browsers:${NC}"
        echo -e "  ${CYAN}1.${NC} Add a new row in the setup feature's Examples table:"
        echo -e "     ${GREEN}tests/03_e2e/04_messages/01_setup.feature${NC}"
        echo ""
        echo -e "     ${CYAN}Examples:${NC}"
        echo -e "       | user  | browser        | user_context | landing_page |"
        echo -e "       | user4 | user4-browser  | user4        | /chat        |"
        echo ""
        echo -e "  ${CYAN}2.${NC} This uses the existing step:"
        echo -e "     ${GREEN}Given a browser \"user4-browser\" with viewport 1280x720${NC}"
        echo ""
        echo -e "  ${CYAN}3.${NC} Ensure the user credentials exist in your test environment"
        echo ""
        read -p "  Continue anyway with ${REQUESTED_USERS} users? (y/N): " CONFIRM </dev/tty
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            echo ""
            echo -e "${CYAN}Usage: npm run record:multi -- --users ${MAX_BROWSERS}${NC} (max available)"
            exit 0
        fi
        echo ""
        echo -e "${YELLOW}⚠ Proceeding with ${REQUESTED_USERS} users. Remember to add missing browser configs before running tests.${NC}"
        echo ""
    fi
fi

# ── If no --users flag, prompt interactively with validation ──
if [ -z "$REQUESTED_USERS" ]; then
    read -p "How many users? (default: 2, max configured: ${MAX_BROWSERS}): " USER_COUNT </dev/tty
    USER_COUNT=${USER_COUNT:-2}

    if [ "$USER_COUNT" -gt "$MAX_BROWSERS" ] 2>/dev/null; then
        echo ""
        echo -e "${RED}⚠ You entered ${USER_COUNT} users, but only ${MAX_BROWSERS} browser instances are configured.${NC}"
        echo -e "${YELLOW}Available: ${AVAILABLE_BROWSERS[*]}${NC}"
        echo ""
        echo -e "${YELLOW}Browsers beyond ${MAX_BROWSERS} won't have setup steps — you'll need to add them manually.${NC}"
        echo ""
        read -p "  Continue anyway? (y/N): " CONFIRM </dev/tty
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            echo ""
            echo -e "${CYAN}Re-run with ${MAX_BROWSERS} or fewer users.${NC}"
            exit 0
        fi
        echo ""
        echo -e "${YELLOW}⚠ Proceeding with ${USER_COUNT} users.${NC}"
    fi

    PASSTHROUGH_ARGS+=("--users" "$USER_COUNT")
fi

echo -e "${YELLOW}⚠ Max ${MAX_BROWSERS} simultaneous users supported with current browser config.${NC}"
echo -e "${CYAN}  Need more? Add a new row in tests/03_e2e/04_messages/01_setup.feature Examples table${NC}"
echo ""

# Run the TypeScript recorder (pass through any args like --setup)
npx ts-node -r tsconfig-paths/register "$SCRIPT_DIR/multi-user-recorder.ts" "${PASSTHROUGH_ARGS[@]}"
