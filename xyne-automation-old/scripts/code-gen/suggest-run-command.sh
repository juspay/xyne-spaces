#!/bin/bash

# Suggests the correct cucumber run command for a generated feature file
# including all necessary prerequisite setup files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check if feature file path is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No feature file path provided${NC}"
    echo "Usage: $0 <path-to-feature-file>"
    echo ""
    echo "Example:"
    echo "  $0 tests/03_e2e/04_messages/02_dm/01_dm-creation.feature"
    exit 1
fi

FEATURE_FILE="$1"

# Resolve actual path - try multiple locations
FEATURE_PATH=""
if [ -f "$FEATURE_FILE" ]; then
    FEATURE_PATH="$FEATURE_FILE"
elif [ -f "$AUTOMATION_DIR/$FEATURE_FILE" ]; then
    FEATURE_PATH="$AUTOMATION_DIR/$FEATURE_FILE"
elif [ -f "$(pwd)/$FEATURE_FILE" ]; then
    FEATURE_PATH="$(pwd)/$FEATURE_FILE"
else
    echo -e "${RED}Error: Feature file not found: $FEATURE_FILE${NC}"
    echo -e "${YELLOW}Tried:${NC}"
    echo "  - $FEATURE_FILE"
    echo "  - $AUTOMATION_DIR/$FEATURE_FILE"
    echo "  - $(pwd)/$FEATURE_FILE"
    exit 1
fi

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Analyzing feature file for prerequisites...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Read feature file content
FEATURE_CONTENT=$(cat "$FEATURE_PATH")

# Extract tags from feature file
FEATURE_TAGS=$(grep -E '^@[a-zA-Z0-9_-]+' "$FEATURE_PATH" | head -1 || echo "")

# Determine which browsers are needed based on content
BROWSERS_NEEDED=()

if echo "$FEATURE_CONTENT" | grep -q 'admin-browser'; then
    BROWSERS_NEEDED+=("admin-browser")
fi
if echo "$FEATURE_CONTENT" | grep -q 'user1-browser'; then
    BROWSERS_NEEDED+=("user1-browser")
fi
if echo "$FEATURE_CONTENT" | grep -q 'user2-browser'; then
    BROWSERS_NEEDED+=("user2-browser")
fi
if echo "$FEATURE_CONTENT" | grep -q 'user3-browser'; then
    BROWSERS_NEEDED+=("user3-browser")
fi

# Determine which stored paths are referenced (exclude browser names)
PATHS_NEEDED=$(echo "$FEATURE_CONTENT" | grep -oE '"[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+"' | tr -d '"' | grep -v "browser" | sort -u || true)

# Determine prerequisite setup files
PREREQ_FILES=()

# Get the relative path of the feature file for comparison
FEATURE_REL_PATH=$(python3 -c "import os; print(os.path.relpath('$FEATURE_PATH', '$AUTOMATION_DIR'))" 2>/dev/null || echo "$FEATURE_FILE")

# Always need main setup if admin-browser or user1-browser is needed
if [[ " ${BROWSERS_NEEDED[@]} " =~ " admin-browser " ]] || [[ " ${BROWSERS_NEEDED[@]} " =~ " user1-browser " ]]; then
    if [ -f "$AUTOMATION_DIR/tests/03_e2e/03_project/01_setup.feature" ]; then
        PREREQ_FILES+=("tests/03_e2e/03_project/01_setup.feature")
    fi
fi

# Need messages setup if user2-browser or user3-browser is needed
if [[ " ${BROWSERS_NEEDED[@]} " =~ " user2-browser " ]] || [[ " ${BROWSERS_NEEDED[@]} " =~ " user3-browser " ]]; then
    if [ -f "$AUTOMATION_DIR/tests/03_e2e/04_messages/01_setup.feature" ]; then
        PREREQ_FILES+=("tests/03_e2e/04_messages/01_setup.feature")
    fi
fi

# Check for resource dependencies based on stored paths
# These would need the feature files that create the resources
for path in $PATHS_NEEDED; do
    # Channel paths need channel creation
    if [[ "$path" == *"channel"* ]]; then
        CHANNEL_CREATE="$AUTOMATION_DIR/tests/03_e2e/04_messages/04_channel/01_channel-creation.feature"
        if [ -f "$CHANNEL_CREATE" ]; then
            # Check if already in prereq list
            if [[ ! " ${PREREQ_FILES[*]} " =~ " tests/03_e2e/04_messages/04_channel/01_channel-creation.feature " ]]; then
                PREREQ_FILES+=("tests/03_e2e/04_messages/04_channel/01_channel-creation.feature")
            fi
        fi
    fi

    # DM paths need DM creation
    if [[ "$path" == *"dm"* ]] || [[ "$path" =~ user[0-9]-user[0-9] ]]; then
        DM_CREATE="$AUTOMATION_DIR/tests/03_e2e/04_messages/02_dm/01_dm-creation.feature"
        if [ -f "$DM_CREATE" ]; then
            if [[ ! " ${PREREQ_FILES[*]} " =~ " tests/03_e2e/04_messages/02_dm/01_dm-creation.feature " ]]; then
                PREREQ_FILES+=("tests/03_e2e/04_messages/02_dm/01_dm-creation.feature")
            fi
        fi
    fi

    # Group chat paths need group chat creation
    if [[ "$path" == *"group-chat"* ]] || [[ "$path" == *"group"* ]]; then
        GROUP_CREATE="$AUTOMATION_DIR/tests/03_e2e/04_messages/03_group_chat/01_group-chat-creation.feature"
        if [ -f "$GROUP_CREATE" ]; then
            if [[ ! " ${PREREQ_FILES[*]} " =~ " tests/03_e2e/04_messages/03_group_chat/01_group-chat-creation.feature " ]]; then
                PREREQ_FILES+=("tests/03_e2e/04_messages/03_group_chat/01_group-chat-creation.feature")
            fi
        fi
    fi
done

# Extract feature-specific tags
FEATURE_SPECIFIC_TAGS=""
if echo "$FEATURE_CONTENT" | grep -q '@dm'; then
    FEATURE_SPECIFIC_TAGS="$FEATURE_SPECIFIC_TAGS @dm"
fi
if echo "$FEATURE_CONTENT" | grep -q '@channel'; then
    FEATURE_SPECIFIC_TAGS="$FEATURE_SPECIFIC_TAGS @channel"
fi
if echo "$FEATURE_CONTENT" | grep -q '@group-chat'; then
    FEATURE_SPECIFIC_TAGS="$FEATURE_SPECIFIC_TAGS @group-chat"
fi
if echo "$FEATURE_CONTENT" | grep -q '@messaging'; then
    FEATURE_SPECIFIC_TAGS="$FEATURE_SPECIFIC_TAGS @messaging"
fi

# Filter out the target feature file from prerequisites
FEATURE_REL_PATH=$(python3 -c "import os; print(os.path.relpath('$FEATURE_PATH', '$AUTOMATION_DIR'))" 2>/dev/null || echo "$FEATURE_FILE")
FILTERED_PREREQ_FILES=()
for prereq in "${PREREQ_FILES[@]}"; do
    if [ "$prereq" != "$FEATURE_REL_PATH" ]; then
        FILTERED_PREREQ_FILES+=("$prereq")
    fi
done

# Display analysis
echo -e "${YELLOW}Feature File:${NC} ${CYAN}$FEATURE_FILE${NC}"
echo ""
echo -e "${YELLOW}Browsers Required:${NC}"
if [ ${#BROWSERS_NEEDED[@]} -eq 0 ]; then
    echo "  (none detected - may use default browser)"
else
    for browser in "${BROWSERS_NEEDED[@]}"; do
        echo -e "  ${GREEN}✓${NC} $browser"
    done
fi
echo ""

if [ -n "$PATHS_NEEDED" ]; then
    echo -e "${YELLOW}Stored Paths Referenced:${NC}"
    for path in $PATHS_NEEDED; do
        echo -e "  ${CYAN}$path${NC}"
    done
    echo ""
fi

# Display prerequisites (show filtered list, not including target file)
echo -e "${YELLOW}Prerequisite Files Required:${NC}"
if [ ${#FILTERED_PREREQ_FILES[@]} -eq 0 ]; then
    echo -e "  ${RED}⚠ No prerequisites detected - standalone test${NC}"
else
    for prereq in "${FILTERED_PREREQ_FILES[@]}"; do
        if [ -f "$AUTOMATION_DIR/$prereq" ]; then
            echo -e "  ${GREEN}✓${NC} $prereq"
        else
            echo -e "  ${RED}✗ MISSING: $prereq${NC}"
        fi
    done
fi
echo ""

# Generate commands
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Run Commands:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Build the full command with prerequisites
# Filter out the target feature file from prerequisites
FILTERED_PREREQ_FILES=()
for prereq in "${PREREQ_FILES[@]}"; do
    if [ "$prereq" != "$FEATURE_REL_PATH" ]; then
        FILTERED_PREREQ_FILES+=("$prereq")
    fi
done

if [ ${#FILTERED_PREREQ_FILES[@]} -gt 0 ]; then
    # Command with prerequisites
    PREREQ_PATHS=""
    for prereq in "${FILTERED_PREREQ_FILES[@]}"; do
        PREREQ_PATHS="$PREREQ_PATHS $prereq"
    done

    echo -e "${YELLOW}# Run with all prerequisites (recommended):${NC}"
    echo -e "${GREEN}npx cucumber-js$PREREQ_PATHS $FEATURE_FILE --profile e2e${NC}"
    echo ""

    # Command using tags
    echo -e "${YELLOW}# Run using tags (runs setup first, then your feature):${NC}"
    echo -e "${GREEN}npx cucumber-js --tags \"@setup or $(basename $FEATURE_FILE .feature)\" --profile e2e${NC}"
    echo ""

    # Quick run command for convenience
    echo -e "${YELLOW}# Quick run (copy-paste):${NC}"
    echo -e "${GREEN}npm run test:e2e -- $PREREQ_PATHS $FEATURE_FILE${NC}"
else
    echo -e "${YELLOW}# Standalone run (no prerequisites):${NC}"
    echo -e "${GREEN}npx cucumber-js $FEATURE_FILE --profile e2e${NC}"
    echo ""

    echo -e "${YELLOW}# Or with npm:${NC}"
    echo -e "${GREEN}npm run test:e2e -- $FEATURE_FILE${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Available Setup Files in Project:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# List all available setup files
find "$AUTOMATION_DIR/tests/03_e2e" -name "01_setup.feature" -o -name "*setup*.feature" 2>/dev/null | while read -r setup_file; do
    rel_path=$(python3 -c "import os; print(os.path.relpath('$setup_file', '$AUTOMATION_DIR'))" 2>/dev/null || echo "$setup_file")
    echo -e "  ${CYAN}$rel_path${NC}"
done

echo ""
echo -e "${YELLOW}Tip:${NC} Setup files create authenticated browser sessions that persist for the entire test run."
echo -e "${YELLOW}Tip:${NC} If your test fails with 'Browser not initialized', run with setup files first."
