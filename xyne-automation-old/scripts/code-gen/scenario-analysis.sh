#!/bin/bash

# Standalone Scenario Analysis Script
# Runs only the LLM scenario duplicate/coverage analysis for a Playwright spec file against an existing folder
# Usage: npm run codegen:scenario-analysis -- <folder> <file.spec.ts>

set -e
shopt -s nullglob

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

# Load prompt template
load_prompt() {
    local template="$1"
    shift
    local content=$(cat "$template" 2>/dev/null || echo "")
    for var in "$@"; do
        local key="${var%%=*}"
        local value="${var#*=}"
        content="${content//\{\{$key\}\}/$value}"
    done
    echo "$content"
}

echo "=========================================="
echo "  Scenario Analysis (standalone)"
echo "=========================================="
echo ""

# Load .env
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -o allexport
    source "$SCRIPT_DIR/.env"
    set +o allexport
fi

if [ -z "$JUSPAY_API_KEY" ]; then
    echo -e "${RED}Error: JUSPAY_API_KEY is not set.${NC}"
    exit 1
fi
export JUSPAY_API_KEY="Bearer $JUSPAY_API_KEY"
export MODEL="${MODEL:-kimi-latest}"

# Check args
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing arguments.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen -- scenario-analysis <file.spec.ts>"
    echo "  npm run codegen -- scenario-analysis <e2e-folder> <file.spec.ts>"
    echo ""
    echo "Arguments:"
    echo "  <file.spec.ts>  Playwright spec file to analyze"
    echo "  <e2e-folder>    (Optional) Name of the e2e folder. If omitted, scans all e2e folders."
    echo ""
    echo "Examples:"
    echo "  npm run codegen -- scenario-analysis tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- scenario-analysis 04_messages test-2.spec.ts"
    echo ""
    exit 1
fi

# Determine if first arg is a folder or a spec file
E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"
TARGET_FOLDER=""
INPUT_FILE=""

if [ $# -ge 2 ] && [ -d "$E2E_DIR/$1" ]; then
    # Two args: folder + file
    TARGET_FOLDER="$1"
    INPUT_FILE="$2"
elif [[ "$1" == *.spec.ts ]]; then
    # Single arg: spec file only — scan all e2e folders
    INPUT_FILE="$1"
else
    # Try as folder name
    if [ -d "$E2E_DIR/$1" ]; then
        echo -e "${RED}Error: Missing spec file argument.${NC}"
        echo "Usage: npm run codegen -- scenario-analysis [e2e-folder] <file.spec.ts>"
        exit 1
    fi
    INPUT_FILE="$1"
fi

TARGET_DIR=""
if [ -n "$TARGET_FOLDER" ]; then
    TARGET_DIR="$E2E_DIR/$TARGET_FOLDER"
    if [ ! -d "$TARGET_DIR" ]; then
        echo -e "${RED}✗ Folder not found: tests/03_e2e/$TARGET_FOLDER${NC}"
        echo ""
        echo "Available folders:"
        for folder in "$E2E_DIR"/*/; do
            [ -d "$folder" ] || continue
            folder_name=$(basename "$folder")
            [[ "$folder_name" == _* ]] && continue
            echo -e "  ${CYAN}${folder_name}${NC}"
        done
        exit 1
    fi
fi

# Resolve file path
ABSOLUTE_PATH=""
if [ -f "$INPUT_FILE" ]; then
    ABSOLUTE_PATH=$(cd "$(dirname "$INPUT_FILE")" && pwd)/$(basename "$INPUT_FILE")
elif [ -f "$AUTOMATION_DIR/$INPUT_FILE" ]; then
    ABSOLUTE_PATH=$(cd "$AUTOMATION_DIR" && pwd)/$INPUT_FILE
elif [ -f "$AUTOMATION_DIR/../$INPUT_FILE" ]; then
    ABSOLUTE_PATH=$(cd "$AUTOMATION_DIR/.." && pwd)/$INPUT_FILE
fi

if [ -z "$ABSOLUTE_PATH" ] || [ ! -f "$ABSOLUTE_PATH" ]; then
    echo -e "${RED}✗ File not found: $INPUT_FILE${NC}"
    exit 1
fi

BASE_NAME=$(basename "$INPUT_FILE" .spec.ts)

echo -e "${CYAN}File:   $INPUT_FILE${NC}"
if [ -n "$TARGET_FOLDER" ]; then
    echo -e "${CYAN}Folder: tests/03_e2e/$TARGET_FOLDER${NC}"
else
    echo -e "${CYAN}Folder: tests/03_e2e/* (all folders)${NC}"
fi
echo -e "${CYAN}Model:  $MODEL${NC}"
echo ""

# Scan existing feature files
EXISTING_FEATURE_FILES=()
if [ -n "$TARGET_FOLDER" ]; then
    echo -e "${CYAN}Existing feature files in ${TARGET_FOLDER}:${NC}"
    while IFS= read -r ef; do
        [ -e "$ef" ] || continue
        EXISTING_FEATURE_FILES+=("$ef")
        scen_count=$(grep -cE '^\s*(Scenario|Scenario Outline):' "$ef" 2>/dev/null || echo "0")
        echo -e "  ${GREEN}$(basename "$ef")${NC} (${scen_count} scenarios)"
    done < <(find "$TARGET_DIR" -maxdepth 1 -name "*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | sort)
else
    echo -e "${CYAN}Scanning all e2e folders for feature files:${NC}"
    for scan_folder in "$E2E_DIR"/*/; do
        [ -d "$scan_folder" ] || continue
        scan_name=$(basename "$scan_folder")
        [[ "$scan_name" == _* ]] && continue
        [[ "$scan_name" == "node_modules" ]] && continue
        while IFS= read -r ef; do
            [ -e "$ef" ] || continue
            EXISTING_FEATURE_FILES+=("$ef")
            scen_count=$(grep -cE '^\s*(Scenario|Scenario Outline):' "$ef" 2>/dev/null || echo "0")
            echo -e "  ${GREEN}${scan_name}/$(basename "$ef")${NC} (${scen_count} scenarios)"
        done < <(find "$scan_folder" -maxdepth 1 -name "*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | sort)
    done
fi

if [ ${#EXISTING_FEATURE_FILES[@]} -eq 0 ]; then
    echo -e "  ${YELLOW}(none)${NC}"
    echo ""
    echo -e "${YELLOW}No existing feature files to compare against. Nothing to analyze.${NC}"
    exit 0
fi

echo ""

# Build existing features content
EXISTING_FEATURES_CONTENT=""
for ef in "${EXISTING_FEATURE_FILES[@]}"; do
    EXISTING_FEATURES_CONTENT="${EXISTING_FEATURES_CONTENT}

### $(basename "$ef")
\`\`\`gherkin
$(cat "$ef")
\`\`\`"
done

# Create LLM prompt
SCENARIO_ANALYSIS_PROMPT=$(mktemp)
load_prompt "$PROMPTS_DIR/scenario-analysis.md" \
    "PLAYWRIGHT_CONTENT=$(cat "$ABSOLUTE_PATH")" \
    "EXISTING_FEATURE_FILES=$EXISTING_FEATURES_CONTENT" \
    > "$SCENARIO_ANALYSIS_PROMPT"

echo -e "${CYAN}Sending to LLM for scenario analysis...${NC}"
echo ""

SCENARIO_ANALYSIS_FILE=$(mktemp)
SCENARIO_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/scenario_analysis"
mkdir -p "$SCENARIO_DEBUG_DIR"
SCENARIO_DEBUG_FILE="$SCENARIO_DEBUG_DIR/${BASE_NAME}_analysis_$(date +%Y%m%d_%H%M%S).log"

set +e
GEMINI_API_KEY="" \
    GOOGLE_CLOUD_PROJECT="" \
    GOOGLE_APPLICATION_CREDENTIALS="" \
    CLAUDE_CODE_USE_VERTEX="" \
    CLOUD_ML_REGION="" \
    GOOGLE_VERTEX_PROJECT="" \
    ANTHROPIC_VERTEX_PROJECT_ID="" \
    ANTHROPIC_BASE_URL="https://grid.ai.example.com/" \
    ANTHROPIC_AUTH_TOKEN="$JUSPAY_API_KEY" \
    ANTHROPIC_MODEL="$MODEL" \
    ANTHROPIC_SMALL_FAST_MODEL="$MODEL" \
    CLAUDE_CODE_SUBAGENT_MODEL="$MODEL" \
    DISABLE_INTERLEAVED_THINKING=true \
    API_TIMEOUT_MS=120000 \
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 \
    claude -p "$(cat "$SCENARIO_ANALYSIS_PROMPT")" \
    > "$SCENARIO_ANALYSIS_FILE" 2>&1
SCENARIO_EXIT=$?
set -e

cp "$SCENARIO_ANALYSIS_FILE" "$SCENARIO_DEBUG_FILE"
rm -f "$SCENARIO_ANALYSIS_PROMPT"

if [ $SCENARIO_EXIT -ne 0 ]; then
    echo -e "${RED}✗ LLM scenario analysis failed (exit code: $SCENARIO_EXIT)${NC}"
    echo -e "${YELLOW}  Debug output: $SCENARIO_DEBUG_FILE${NC}"
    cat "$SCENARIO_ANALYSIS_FILE"
    exit 1
fi

# Display results
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Scenario Coverage Analysis Results:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
# Extract JSON from output (skip non-JSON lines like Bun warnings, handle code fences)
JSON_CONTENT=""
if command -v python3 &>/dev/null; then
    JSON_CONTENT=$(python3 -c "
import sys, json, re
content = open(sys.argv[1]).read()
content = re.sub(r'\`\`\`\w*\n?', '', content)
depth = 0; start = -1
for i, c in enumerate(content):
    if c == '{':
        if depth == 0: start = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0 and start >= 0:
            candidate = content[start:i+1]
            try:
                json.loads(candidate); print(candidate); sys.exit(0)
            except: start = -1
" "$SCENARIO_ANALYSIS_FILE" 2>/dev/null)
fi
if [ -n "$JSON_CONTENT" ]; then
    echo "$JSON_CONTENT" | python3 -m json.tool 2>/dev/null || echo "$JSON_CONTENT"
else
    cat "$SCENARIO_ANALYSIS_FILE"
fi
echo ""
echo -e "${YELLOW}Full output saved to: $SCENARIO_DEBUG_FILE${NC}"

rm -f "$SCENARIO_ANALYSIS_FILE"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📋 What's next?${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}1) Run combined analysis (folder + scenario):${NC}"
echo -e "   ${GREEN}npm run codegen -- analyze $INPUT_FILE${NC}"
echo ""
echo -e "${YELLOW}2) Convert with skip analysis:${NC}"
echo -e "   ${GREEN}npm run codegen -- convert:skip-all --retry-folder $TARGET_FOLDER $INPUT_FILE${NC}"
echo ""
echo -e "${YELLOW}3) Full pipeline (testids + analysis + convert + dry-run + test):${NC}"
echo -e "   ${GREEN}npm run codegen -- convert $INPUT_FILE${NC}"
echo ""