#!/bin/bash

# Standalone Folder Analysis Script
# Runs only the LLM folder placement analysis for a Playwright spec file
# Usage: npm run codegen:folder-analysis -- <file.spec.ts>

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
echo "  Folder Analysis (standalone)"
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
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No Playwright spec file provided.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen:folder-analysis -- <file.spec.ts>"
    echo ""
    echo "Examples:"
    echo "  npm run codegen:folder-analysis -- test-1.spec.ts"
    echo "  npm run codegen:folder-analysis -- tests/actions/test-2.spec.ts"
    exit 1
fi

INPUT_FILE="$1"

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
E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"
cd "$E2E_DIR"

echo -e "${CYAN}File: $INPUT_FILE${NC}"
echo -e "${CYAN}Model: $MODEL${NC}"
echo ""

# Scan existing e2e folder structure
echo -e "${CYAN}Scanning existing test structure...${NC}"
echo ""

E2E_STRUCTURE=""
for folder in */; do
    [ -d "$folder" ] || continue
    folder_name=$(basename "$folder")
    [[ "$folder_name" == _* ]] && continue
    [[ "$folder_name" == "node_modules" ]] && continue

    E2E_STRUCTURE="${E2E_STRUCTURE}${folder_name}/\n"

    # Scan feature files recursively (including subdirectories, excluding _previous)
    while IFS= read -r feat; do
        [ -e "$feat" ] || continue
        feat_rel=$(realpath --relative-to="$E2E_DIR" "$feat" 2>/dev/null || echo "$feat")
        scenarios=$(grep -E '^\s*(Scenario|Scenario Outline):' "$feat" 2>/dev/null | sed -E 's/^\s*(Scenario|Scenario Outline):\s*//' || true)
        if [ -n "$scenarios" ]; then
            E2E_STRUCTURE="${E2E_STRUCTURE}  ${feat_rel}\n"
            while IFS= read -r scn; do
                E2E_STRUCTURE="${E2E_STRUCTURE}    - ${scn}\n"
            done <<< "$scenarios"
        fi
    done < <(find "$folder" -name "*.feature" -not -path "*/_previous/*" -not -path "*/node_modules/*" -type f 2>/dev/null | sort)

    E2E_STRUCTURE="${E2E_STRUCTURE}\n"
done

echo -e "${CYAN}Current folder structure:${NC}"
echo -e "$E2E_STRUCTURE"
echo ""

# Create LLM prompt
FOLDER_ANALYSIS_PROMPT=$(mktemp)
load_prompt "$PROMPTS_DIR/folder-analysis.md" \
    "E2E_STRUCTURE=$E2E_STRUCTURE" \
    "PLAYWRIGHT_CONTENT=$(cat "$ABSOLUTE_PATH")" \
    > "$FOLDER_ANALYSIS_PROMPT"

echo -e "${CYAN}Sending to LLM for folder analysis...${NC}"
echo ""

FOLDER_ANALYSIS_FILE=$(mktemp)
FOLDER_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/folder_analysis"
mkdir -p "$FOLDER_DEBUG_DIR"
FOLDER_DEBUG_FILE="$FOLDER_DEBUG_DIR/${BASE_NAME}_analysis_$(date +%Y%m%d_%H%M%S).log"

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
    claude -p "$(cat "$FOLDER_ANALYSIS_PROMPT")" \
    > "$FOLDER_ANALYSIS_FILE" 2>&1
FOLDER_EXIT=$?
set -e

cp "$FOLDER_ANALYSIS_FILE" "$FOLDER_DEBUG_FILE"
rm -f "$FOLDER_ANALYSIS_PROMPT"

if [ $FOLDER_EXIT -ne 0 ]; then
    echo -e "${RED}✗ LLM folder analysis failed (exit code: $FOLDER_EXIT)${NC}"
    echo -e "${YELLOW}  Debug output: $FOLDER_DEBUG_FILE${NC}"
    cat "$FOLDER_ANALYSIS_FILE"
    exit 1
fi

# Display results (pretty-print if JSON)
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Folder Analysis Results:${NC}"
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
" "$FOLDER_ANALYSIS_FILE" 2>/dev/null)
fi
if [ -n "$JSON_CONTENT" ]; then
    echo "$JSON_CONTENT" | python3 -m json.tool 2>/dev/null || echo "$JSON_CONTENT"
else
    cat "$FOLDER_ANALYSIS_FILE"
fi
echo ""
echo -e "${YELLOW}Full output saved to: $FOLDER_DEBUG_FILE${NC}"

# Suggest next commands
RECOMMENDED_FOLDER=$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    rec = data.get('recommendation', {})
    print(rec.get('folder_name', ''))
except: pass
" 2>/dev/null || true)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📋 What's next?${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}1) Run combined analysis (folder + scenario):${NC}"
echo -e "   ${GREEN}npm run codegen -- analyze $INPUT_FILE${NC}"
echo ""
if [ -n "$RECOMMENDED_FOLDER" ]; then
    echo -e "${YELLOW}2) Convert directly using recommended folder (${RECOMMENDED_FOLDER}):${NC}"
    echo -e "   ${GREEN}npm run codegen -- convert:skip-all --retry-folder ${RECOMMENDED_FOLDER} $INPUT_FILE${NC}"
    echo ""
    echo -e "${YELLOW}3) Full pipeline (testids + analysis + convert + dry-run + test):${NC}"
    echo -e "   ${GREEN}npm run codegen -- convert $INPUT_FILE${NC}"
else
    echo -e "${YELLOW}2) Full pipeline (testids + analysis + convert + dry-run + test):${NC}"
    echo -e "   ${GREEN}npm run codegen -- convert $INPUT_FILE${NC}"
fi
echo ""

rm -f "$FOLDER_ANALYSIS_FILE"