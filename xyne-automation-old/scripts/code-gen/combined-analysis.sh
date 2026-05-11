#!/bin/bash

# Combined Analysis Script — single LLM call for folder placement + scenario coverage
# Usage: npm run codegen -- analyze <file.spec.ts>
#        npm run codegen -- analyze <e2e-folder> <file.spec.ts>

set -e
shopt -s nullglob

# Ensure Ctrl+C exits immediately
trap 'echo -e "\n\033[0;31m✗ Interrupted by user (Ctrl+C)\033[0m"; exit 130' INT TERM

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

# Load prompt template and substitute variables
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
echo "  Combined Analysis (folder + scenario)"
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
# Don't re-add Bearer if already present
if [[ "$JUSPAY_API_KEY" != Bearer* ]]; then
    export JUSPAY_API_KEY="Bearer $JUSPAY_API_KEY"
fi
export MODEL="${MODEL:-kimi-latest}"

# Check args
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing arguments.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen -- analyze <file.spec.ts>"
    echo "  npm run codegen -- analyze <e2e-folder> <file.spec.ts>"
    echo ""
    echo "Arguments:"
    echo "  <file.spec.ts>  Playwright spec file to analyze"
    echo "  <e2e-folder>    (Optional) Limit scenario check to this folder. If omitted, scans all."
    echo ""
    echo "Examples:"
    echo "  npm run codegen -- analyze tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- analyze 04_messages tests/actions/test-2.spec.ts"
    echo ""
    exit 1
fi

# Determine if first arg is a folder or a spec file
E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"
TARGET_FOLDER=""
INPUT_FILE=""

if [ $# -ge 2 ] && [ -d "$E2E_DIR/$1" ]; then
    TARGET_FOLDER="$1"
    INPUT_FILE="$2"
elif [[ "$1" == *.spec.ts ]]; then
    INPUT_FILE="$1"
else
    if [ -d "$E2E_DIR/$1" ]; then
        echo -e "${RED}Error: Missing spec file argument.${NC}"
        echo "Usage: npm run codegen -- analyze [e2e-folder] <file.spec.ts>"
        exit 1
    fi
    INPUT_FILE="$1"
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
    echo -e "${CYAN}Scope:  tests/03_e2e/$TARGET_FOLDER${NC}"
else
    echo -e "${CYAN}Scope:  tests/03_e2e/* (all folders)${NC}"
fi
echo -e "${CYAN}Model:  $MODEL${NC}"
echo ""

# ============================================================
# Scan folder structure (for folder analysis)
# ============================================================
echo -e "${CYAN}Scanning existing test structure...${NC}"
cd "$E2E_DIR"

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

# ============================================================
# Scan feature files (for scenario analysis)
# ============================================================
EXISTING_FEATURE_FILES=()

if [ -n "$TARGET_FOLDER" ]; then
    TARGET_DIR="$E2E_DIR/$TARGET_FOLDER"
    echo -e "${CYAN}Feature files in ${TARGET_FOLDER}:${NC}"
    while IFS= read -r ef; do
        [ -e "$ef" ] || continue
        EXISTING_FEATURE_FILES+=("$ef")
        scen_count=$(grep -cE '^\s*(Scenario|Scenario Outline):' "$ef" 2>/dev/null || echo "0")
        echo -e "  ${GREEN}$(basename "$ef")${NC} (${scen_count} scenarios)"
    done < <(find "$TARGET_DIR" -maxdepth 1 -name "*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | sort)
else
    echo -e "${CYAN}Feature files across all e2e folders:${NC}"
    FOUND_ANY=false
    for scan_folder in "$E2E_DIR"/*/; do
        [ -d "$scan_folder" ] || continue
        scan_name=$(basename "$scan_folder")
        [[ "$scan_name" == _* ]] && continue
        [[ "$scan_name" == "node_modules" ]] && continue
        folder_feature_count=0
        while IFS= read -r ef; do
            [ -z "$ef" ] && continue
            [ -e "$ef" ] || continue
            EXISTING_FEATURE_FILES+=("$ef")
            folder_feature_count=$((folder_feature_count + 1))
            ef_rel=$(realpath --relative-to="$E2E_DIR" "$ef" 2>/dev/null || echo "${scan_name}/$(basename "$ef")")
            scen_count=$(grep -cE '^\s*(Scenario|Scenario Outline):' "$ef" 2>/dev/null || echo "0")
            echo -e "  ${GREEN}${ef_rel}${NC} (${scen_count} scenarios)"
            FOUND_ANY=true
        done <<< "$(find "$scan_folder" -name "*.feature" -not -path "*/_previous/*" -not -path "*/node_modules/*" -type f 2>/dev/null | sort)"
        if [ "$folder_feature_count" -eq 0 ]; then
            echo -e "  ${YELLOW}${scan_name}/${NC} (empty)"
        fi
    done
fi

# Build existing features content
EXISTING_FEATURES_CONTENT=""
if [ ${#EXISTING_FEATURE_FILES[@]} -gt 0 ]; then
    for ef in "${EXISTING_FEATURE_FILES[@]}"; do
        ef_rel=$(realpath --relative-to="$E2E_DIR" "$ef" 2>/dev/null || basename "$ef")
        EXISTING_FEATURES_CONTENT="${EXISTING_FEATURES_CONTENT}

### ${ef_rel}
\`\`\`gherkin
$(cat "$ef")
\`\`\`"
    done
else
    EXISTING_FEATURES_CONTENT="(No existing feature files found)"
fi

echo ""

# ============================================================
# Single LLM call — combined analysis
# ============================================================
ANALYSIS_PROMPT=$(mktemp)
load_prompt "$PROMPTS_DIR/combined-analysis.md" \
    "E2E_STRUCTURE=$E2E_STRUCTURE" \
    "PLAYWRIGHT_CONTENT=$(cat "$ABSOLUTE_PATH")" \
    "EXISTING_FEATURE_FILES=$EXISTING_FEATURES_CONTENT" \
    > "$ANALYSIS_PROMPT"

echo -e "${CYAN}Sending to LLM for combined analysis (1 call)...${NC}"
echo ""

ANALYSIS_FILE=$(mktemp)
ANALYSIS_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/combined_analysis"
mkdir -p "$ANALYSIS_DEBUG_DIR"
ANALYSIS_DEBUG_FILE="$ANALYSIS_DEBUG_DIR/${BASE_NAME}_analysis_$(date +%Y%m%d_%H%M%S).log"

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
    claude -p "$(cat "$ANALYSIS_PROMPT")" \
    > "$ANALYSIS_FILE" 2>&1
ANALYSIS_EXIT=$?
set -e

cp "$ANALYSIS_FILE" "$ANALYSIS_DEBUG_FILE"
rm -f "$ANALYSIS_PROMPT"

if [ $ANALYSIS_EXIT -ne 0 ]; then
    echo -e "${RED}✗ LLM analysis failed (exit code: $ANALYSIS_EXIT)${NC}"
    echo -e "${YELLOW}  Debug output: $ANALYSIS_DEBUG_FILE${NC}"
    cat "$ANALYSIS_FILE"
    exit 1
fi

# Extract JSON from LLM output (handles multi-line JSON, code fences, Bun warnings)
JSON_CONTENT=""
if command -v python3 &>/dev/null; then
    JSON_CONTENT=$(python3 -c "
import sys, json, re

content = open(sys.argv[1]).read()

# Strip code fences (```json ... ```)
content = re.sub(r'\`\`\`\w*\n?', '', content)

# Find the outermost JSON object
depth = 0
start = -1
for i, c in enumerate(content):
    if c == '{':
        if depth == 0:
            start = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0 and start >= 0:
            candidate = content[start:i+1]
            try:
                json.loads(candidate)
                print(candidate)
                sys.exit(0)
            except:
                start = -1
" "$ANALYSIS_FILE" 2>/dev/null)
fi

if [ -z "$JSON_CONTENT" ]; then
    # Fallback: try single-line grep
    JSON_CONTENT=$(grep -oE '\{.*\}' "$ANALYSIS_FILE" 2>/dev/null | tail -1)
fi

# Display Folder Analysis
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📁 Folder Placement Analysis:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
if [ -n "$JSON_CONTENT" ] && command -v python3 &>/dev/null; then
    echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    fa = data.get('folder_analysis', {})
    print(f\"  Analysis: {fa.get('analysis', 'N/A')}\")
    print()
    for m in fa.get('matches', []):
        pct = m.get('similarity_percentage', 0)
        bar = '█' * (pct // 5) + '░' * (20 - pct // 5)
        print(f\"  {m.get('folder', '?'):30s} [{bar}] {pct}%\")
        print(f\"    {m.get('reasoning', '')}\")
        print()
    rec = fa.get('recommendation', {})
    if rec:
        is_new = '(NEW)' if rec.get('is_new_folder') else '(existing)'
        print(f\"  ✓ Recommendation: {rec.get('folder_name', '?')} {is_new}\")
        print(f\"    {rec.get('reasoning', '')}\")
    new_sug = fa.get('new_folder_suggestion', '')
    if new_sug:
        print(f\"  💡 New folder suggestion: {new_sug}\")
except Exception as e:
    print(f'  (Could not parse: {e})')
" 2>/dev/null || echo "$JSON_CONTENT" | python3 -m json.tool 2>/dev/null || cat "$ANALYSIS_FILE"
else
    cat "$ANALYSIS_FILE"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🔍 Scenario Coverage Analysis:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
if [ -n "$JSON_CONTENT" ] && command -v python3 &>/dev/null; then
    echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    sa = data.get('scenario_analysis', {})
    scenarios = sa.get('spec_scenarios', [])
    for i, s in enumerate(scenarios, 1):
        status = s.get('status', '?')
        icon = {'new': '🆕', 'duplicate': '🔄', 'partial_overlap': '⚠️'}.get(status, '❓')
        print(f\"  {icon} Scenario {i}: {s.get('description', 'N/A')}\")
        print(f\"     Status: {status} ({s.get('overlap_percentage', 0)}% overlap)\")
        if s.get('matching_feature'):
            print(f\"     Matches: {s.get('matching_feature')} → {s.get('matching_scenario', '')}\")
        print(f\"     {s.get('reasoning', '')}\")
        print()
    summary = sa.get('summary', {})
    if summary:
        total = summary.get('total_in_spec', 0)
        new = summary.get('new_scenarios', 0)
        dups = summary.get('duplicates', 0)
        partial = summary.get('partial_overlaps', 0)
        rec = summary.get('recommendation', '')
        print(f\"  Summary: {total} total | {new} new | {dups} duplicates | {partial} partial\")
        rec_icon = {'generate_all': '✅', 'generate_new_only': '⚠️', 'skip_all': '⏭'}.get(rec, '❓')
        print(f\"  {rec_icon} Recommendation: {rec}\")
except Exception as e:
    print(f'  (Could not parse: {e})')
" 2>/dev/null || echo "$JSON_CONTENT" | python3 -m json.tool 2>/dev/null || cat "$ANALYSIS_FILE"
else
    cat "$ANALYSIS_FILE"
fi

echo ""
echo -e "${YELLOW}Full output saved to: $ANALYSIS_DEBUG_FILE${NC}"

# ============================================================
# Interactive: Folder Placement Decision
# ============================================================
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}The LLM identified the above-mentioned folders and files as having similarities.${NC}"
echo -e "${YELLOW}What would you like to do?${NC}"
echo -e "  ${CYAN}1)${NC} Skip conversion (keep existing tests)"
echo -e "  ${CYAN}2)${NC} Use LLM's recommended folder"
echo -e "  ${CYAN}3)${NC} Choose a different existing folder"
echo -e "  ${CYAN}4)${NC} Create a new folder with custom name"
echo ""

# Extract recommendation from JSON
RECOMMENDED_FOLDER=""
IS_NEW_FOLDER="false"
NEW_FOLDER_SUGGESTION=""
FOLDER_MATCHES=()
FOLDER_SIMILARITIES=()

if [ -n "$JSON_CONTENT" ] && command -v python3 &>/dev/null; then
    RECOMMENDED_FOLDER=$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    rec = data.get('folder_analysis', {}).get('recommendation', {})
    print(rec.get('folder_name', ''))
except: pass
" 2>/dev/null)
    IS_NEW_FOLDER=$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    rec = data.get('folder_analysis', {}).get('recommendation', {})
    print(str(rec.get('is_new_folder', False)).lower())
except: print('false')
" 2>/dev/null)
    NEW_FOLDER_SUGGESTION=$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('folder_analysis', {}).get('new_folder_suggestion', ''))
except: pass
" 2>/dev/null)
    # Extract all folder matches
    eval "$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    matches = data.get('folder_analysis', {}).get('matches', [])
    for i, m in enumerate(matches):
        print(f\"FOLDER_MATCHES[{i}]='{m.get('folder', '')}';\")
        print(f\"FOLDER_SIMILARITIES[{i}]='{m.get('similarity_percentage', 0)}';\")
except: pass
" 2>/dev/null)"
fi

if [ -n "$RECOMMENDED_FOLDER" ]; then
    if [ "$IS_NEW_FOLDER" = "true" ]; then
        echo -e "${CYAN}LLM recommends creating new folder: ${GREEN}${RECOMMENDED_FOLDER}${NC}"
    else
        echo -e "${CYAN}LLM recommends: ${GREEN}${RECOMMENDED_FOLDER}${NC}"
    fi
    if [ -n "$NEW_FOLDER_SUGGESTION" ] && [ "$NEW_FOLDER_SUGGESTION" != "$RECOMMENDED_FOLDER" ]; then
        echo -e "${CYAN}Alternative new folder suggestion: ${YELLOW}${NEW_FOLDER_SUGGESTION}${NC}"
    fi
    echo ""
fi

FOLDER_CHOICE=""
ATTEMPT=0
MAX_ATTEMPTS=10
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    echo -n -e "${YELLOW}Type your choice (1-4) and press Enter [attempt ${ATTEMPT}/${MAX_ATTEMPTS}]: ${NC}"
    read -r FOLDER_CHOICE < /dev/tty
    FOLDER_CHOICE=$(echo "$FOLDER_CHOICE" | tr -d '[:space:]' | head -c 1)
    if [[ "$FOLDER_CHOICE" =~ ^[1-4]$ ]]; then
        echo -e "${GREEN}✓ Selected option: ${FOLDER_CHOICE}${NC}"
        break
    else
        echo -e "${RED}Invalid input. Please enter 1, 2, 3, or 4.${NC}"
        FOLDER_CHOICE=""
    fi
done

if [ -z "$FOLDER_CHOICE" ] || ! [[ "$FOLDER_CHOICE" =~ ^[1-4]$ ]]; then
    echo -e "${RED}Max attempts reached. Exiting.${NC}"
    exit 1
fi

echo ""

SELECTED_FOLDER=""

while [ -z "$SELECTED_FOLDER" ]; do

if [ "$FOLDER_CHOICE" = "1" ]; then
    echo -e "${CYAN}Skipping conversion. Analysis complete.${NC}"
    rm -f "$ANALYSIS_FILE"
    exit 0

elif [ "$FOLDER_CHOICE" = "2" ]; then
    # Show matched folders from LLM analysis for selection
    echo ""
    echo -e "${YELLOW}LLM found potential folders. Choose one:${NC}"
    
    folder_idx=1
    declare -a FOLDER_OPTIONS

    # List matched folders from analysis
    for i in "${!FOLDER_MATCHES[@]}"; do
        fm="${FOLDER_MATCHES[$i]}"
        fs="${FOLDER_SIMILARITIES[$i]}"
        if [ -n "$fm" ] && [ -d "$E2E_DIR/$fm" ]; then
            FOLDER_OPTIONS[$folder_idx]="$fm"
            echo -e "  ${CYAN}${folder_idx})${NC} ${fm} ${YELLOW}(${fs}% match)${NC}"
            folder_idx=$((folder_idx + 1))
        fi
    done

    # Add recommended folder if not already in list
    if [ -n "$RECOMMENDED_FOLDER" ] && [ -d "$E2E_DIR/$RECOMMENDED_FOLDER" ]; then
        ALREADY_LISTED=false
        for opt in "${FOLDER_OPTIONS[@]}"; do
            [ "$opt" = "$RECOMMENDED_FOLDER" ] && ALREADY_LISTED=true
        done
        if [ "$ALREADY_LISTED" = false ]; then
            FOLDER_OPTIONS[$folder_idx]="$RECOMMENDED_FOLDER"
            echo -e "  ${CYAN}${folder_idx})${NC} ${RECOMMENDED_FOLDER} ${GREEN}(LLM recommended)${NC}"
            folder_idx=$((folder_idx + 1))
        fi
    fi

    # If LLM recommends a new folder
    if [ "$IS_NEW_FOLDER" = "true" ] && [ -n "$RECOMMENDED_FOLDER" ]; then
        echo ""
        echo -e "${YELLOW}LLM recommends creating a new folder: ${CYAN}${RECOMMENDED_FOLDER}${NC}"
        echo -e "${YELLOW}Creating new folder...${NC}"
        MAX_NUM=0
        for d in "$E2E_DIR"/*/; do
            [ -d "$d" ] || continue
            num=$(basename "$d" | grep -oE '^[0-9]+' || echo "0")
            [ "$((10#$num))" -gt "$((10#$MAX_NUM))" ] && MAX_NUM="$((10#$num))"
        done
        NEXT_NUM=$(printf "%02d" $((MAX_NUM + 1)))
        CLEAN_NAME=$(echo "$RECOMMENDED_FOLDER" | sed -E 's/^[0-9]+_//')
        SELECTED_FOLDER="${NEXT_NUM}_${CLEAN_NAME}"
        mkdir -p "$E2E_DIR/$SELECTED_FOLDER"
        echo -e "${GREEN}✓ Created new folder: tests/03_e2e/${SELECTED_FOLDER}${NC}"
    elif [ ${#FOLDER_OPTIONS[@]} -eq 0 ]; then
        echo -e "${RED}No matching folders found from LLM analysis.${NC}"
        echo -e "${YELLOW}Falling back to folder list...${NC}"
        echo ""
        # Fall through to option 3 logic
        FOLDER_CHOICE="3"
    else
        echo ""
        echo -n -e "${YELLOW}Type folder number and press Enter: ${NC}"
        FOLD_ATTEMPT=0
        while [ $FOLD_ATTEMPT -lt $MAX_ATTEMPTS ]; do
            FOLD_ATTEMPT=$((FOLD_ATTEMPT + 1))
            read -r FOLD_NUM < /dev/tty
            FOLD_NUM=$(echo "$FOLD_NUM" | tr -d '[:space:]' | head -c 2)
            if [ -n "$FOLD_NUM" ] && [ "$FOLD_NUM" -ge 1 ] 2>/dev/null && [ "$FOLD_NUM" -lt "$folder_idx" ] 2>/dev/null; then
                SELECTED_FOLDER="${FOLDER_OPTIONS[$FOLD_NUM]}"
                echo -e "${GREEN}✓ Selected: tests/03_e2e/${SELECTED_FOLDER}${NC}"
                break
            else
                echo -e "${RED}Invalid selection. Please try again. [attempt ${FOLD_ATTEMPT}/${MAX_ATTEMPTS}]${NC}"
                echo -n -e "${YELLOW}Type folder number and press Enter: ${NC}"
            fi
        done
    fi

elif [ "$FOLDER_CHOICE" = "3" ]; then
    echo ""
    echo -e "${YELLOW}Available folders:${NC}"
    folder_idx=1
    declare -a FOLDER_LIST
    for folder in "$E2E_DIR"/*/; do
        [ -d "$folder" ] || continue
        fn=$(basename "$folder")
        [[ "$fn" == _* ]] && continue
        [[ "$fn" == "node_modules" ]] && continue
        feat_count=$(find "$folder" -maxdepth 1 -name "*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | wc -l | tr -d ' ')
        FOLDER_LIST[$folder_idx]="$fn"
        echo -e "  ${CYAN}${folder_idx})${NC} ${fn} (${feat_count} features)"
        folder_idx=$((folder_idx + 1))
        # Show subdirectories as separate selectable entries
        while IFS= read -r sub_dir; do
            [ -z "$sub_dir" ] && continue
            sub_name=$(basename "$sub_dir")
            sub_feat_count=$(find "$sub_dir" -maxdepth 1 -name "*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | wc -l | tr -d ' ')
            FOLDER_LIST[$folder_idx]="${fn}/${sub_name}"
            echo -e "  ${CYAN}${folder_idx})${NC}    ${fn}/${sub_name} (${sub_feat_count} features)"
            folder_idx=$((folder_idx + 1))
        done <<< "$(find "$folder" -mindepth 1 -maxdepth 1 -type d -not -name '_*' -not -name 'node_modules' -not -name 'steps' 2>/dev/null | sort)"
    done
    echo ""
    echo -n -e "${YELLOW}Select folder number: ${NC}"
    FOLD_ATTEMPT=0
    while [ $FOLD_ATTEMPT -lt $MAX_ATTEMPTS ]; do
        FOLD_ATTEMPT=$((FOLD_ATTEMPT + 1))
        read -r FOLD_NUM < /dev/tty
        FOLD_NUM=$(echo "$FOLD_NUM" | tr -d '[:space:]' | head -c 3)
        if [ -n "$FOLD_NUM" ] && [ "$FOLD_NUM" -ge 1 ] 2>/dev/null && [ "$FOLD_NUM" -lt "$folder_idx" ] 2>/dev/null; then
            SELECTED_FOLDER="${FOLDER_LIST[$FOLD_NUM]}"
            echo -e "${GREEN}✓ Selected: tests/03_e2e/${SELECTED_FOLDER}${NC}"
            break
        else
            echo -e "${RED}Invalid. Enter 1-$((folder_idx - 1)). [attempt ${FOLD_ATTEMPT}/${MAX_ATTEMPTS}]${NC}"
            echo -n -e "${YELLOW}Select folder number: ${NC}"
        fi
    done

elif [ "$FOLDER_CHOICE" = "4" ]; then
    echo ""
    echo -e "${YELLOW}Enter new folder name (without number prefix):${NC}"
    echo -e "${YELLOW}Example: user-settings, direct-messages, calls${NC}"
    if [ -n "$NEW_FOLDER_SUGGESTION" ]; then
        echo -e "${CYAN}Suggestion: ${NEW_FOLDER_SUGGESTION}${NC}"
    fi
    echo -n -e "${YELLOW}Folder name: ${NC}"
    read -r NEW_NAME < /dev/tty

    if [ -z "$NEW_NAME" ] && [ -n "$NEW_FOLDER_SUGGESTION" ]; then
        NEW_NAME="$NEW_FOLDER_SUGGESTION"
    fi
    if [ -z "$NEW_NAME" ]; then
        echo -e "${RED}Folder name cannot be empty. Exiting.${NC}"
        exit 1
    fi
    if ! [[ "$NEW_NAME" =~ ^[a-z0-9-]+$ ]]; then
        echo -e "${RED}Invalid folder name. Use lowercase letters, numbers, and hyphens only.${NC}"
        exit 1
    fi
    # Strip any existing number prefix and add next available
    NEW_NAME=$(echo "$NEW_NAME" | sed -E 's/^[0-9]+_//')
    MAX_NUM=0
    for d in "$E2E_DIR"/*/; do
        [ -d "$d" ] || continue
        num=$(basename "$d" | grep -oE '^[0-9]+' || echo "0")
        [ "$((10#$num))" -gt "$((10#$MAX_NUM))" ] && MAX_NUM="$((10#$num))"
    done
    NEXT_NUM=$(printf "%02d" $((MAX_NUM + 1)))
    SELECTED_FOLDER="${NEXT_NUM}_${NEW_NAME}"
    mkdir -p "$E2E_DIR/$SELECTED_FOLDER"
    echo -e "${GREEN}✓ Created new folder: tests/03_e2e/${SELECTED_FOLDER}${NC}"

else
    echo -e "${RED}Invalid choice. Exiting.${NC}"
    exit 1
fi

# If no folder was selected yet, re-prompt
if [ -z "$SELECTED_FOLDER" ]; then
    echo ""
    echo -e "${YELLOW}No folder was selected. Please choose again:${NC}"
    echo -e "  ${CYAN}1)${NC} Skip conversion (keep existing tests)"
    echo -e "  ${CYAN}2)${NC} Use LLM's recommended folder"
    echo -e "  ${CYAN}3)${NC} Choose a different existing folder"
    echo -e "  ${CYAN}4)${NC} Create a new folder with custom name"
    echo ""
    echo -n -e "${YELLOW}Type your choice (1-4) and press Enter: ${NC}"
    read -r FOLDER_CHOICE < /dev/tty
    FOLDER_CHOICE=$(echo "$FOLDER_CHOICE" | tr -d '[:space:]' | head -c 1)
    if ! [[ "$FOLDER_CHOICE" =~ ^[1-4]$ ]]; then
        echo -e "${RED}Invalid input. Please enter 1, 2, 3, or 4.${NC}"
        FOLDER_CHOICE="3"
    fi
    echo ""
fi

done

if [ -z "$SELECTED_FOLDER" ]; then
    echo -e "${RED}No folder selected. Exiting.${NC}"
    exit 1
fi

# ============================================================
# Interactive: Scenario Decision
# ============================================================
echo ""

# Extract scenario recommendation
SCENARIO_REC=""
if [ -n "$JSON_CONTENT" ] && command -v python3 &>/dev/null; then
    SCENARIO_REC=$(echo "$JSON_CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('scenario_analysis', {}).get('summary', {}).get('recommendation', ''))
except: pass
" 2>/dev/null)
fi

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}What would you like to do with scenarios?${NC}"
echo -e "  ${CYAN}1)${NC} Skip - keep existing files, do not generate anything"
echo -e "  ${CYAN}2)${NC} Update - only generate scenarios NOT already covered"
echo -e "  ${CYAN}3)${NC} Regenerate all - generate all scenarios into NEW files"
echo ""

if [ -n "$SCENARIO_REC" ]; then
    case "$SCENARIO_REC" in
        generate_all)      echo -e "${CYAN}LLM recommends: Regenerate all (no overlaps found)${NC}" ;;
        generate_new_only) echo -e "${CYAN}LLM recommends: Update only (some overlaps detected)${NC}" ;;
        skip_all)          echo -e "${CYAN}LLM recommends: Skip all (everything already covered)${NC}" ;;
    esac
    echo ""
fi

echo -n -e "${YELLOW}Choose [1/2/3]: ${NC}"
SCENARIO_CHOICE=""
SCEN_ATTEMPT=0
while [ $SCEN_ATTEMPT -lt $MAX_ATTEMPTS ]; do
    SCEN_ATTEMPT=$((SCEN_ATTEMPT + 1))
    read -r SCENARIO_CHOICE < /dev/tty
    SCENARIO_CHOICE=$(echo "$SCENARIO_CHOICE" | tr -d '[:space:]' | head -c 1)
    if [[ "$SCENARIO_CHOICE" =~ ^[1-3]$ ]]; then
        echo -e "${GREEN}✓ Selected option: ${SCENARIO_CHOICE}${NC}"
        break
    else
        echo -e "${RED}Invalid input. Please enter 1, 2, or 3.${NC}"
        echo -n -e "${YELLOW}Choose [1/2/3]: ${NC}"
        SCENARIO_CHOICE=""
    fi
done

if [ -z "$SCENARIO_CHOICE" ] || ! [[ "$SCENARIO_CHOICE" =~ ^[1-3]$ ]]; then
    echo -e "${RED}Max attempts reached. Defaulting to option 3 (regenerate all).${NC}"
    SCENARIO_CHOICE="3"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Summary:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${YELLOW}Spec file:${NC}  ${CYAN}$INPUT_FILE${NC}"
echo -e "  ${YELLOW}Folder:${NC}     ${CYAN}tests/03_e2e/${SELECTED_FOLDER}${NC}"

case "$SCENARIO_CHOICE" in
    1)
        echo -e "  ${YELLOW}Action:${NC}     ${YELLOW}Skip - no generation${NC}"
        echo ""
        echo -e "${CYAN}Analysis complete. No files generated.${NC}"
        ;;
    2)
        echo -e "  ${YELLOW}Action:${NC}     ${GREEN}Update - generate new scenarios only${NC}"
        echo ""
        echo -e "${CYAN}To run the conversion now:${NC}"
        echo -e "  ${GREEN}npm run codegen -- convert:skip-all --retry-folder ${SELECTED_FOLDER} ${INPUT_FILE}${NC}"
        ;;
    3)
        echo -e "  ${YELLOW}Action:${NC}     ${GREEN}Regenerate all scenarios${NC}"
        echo ""
        echo -e "${CYAN}To run the conversion now:${NC}"
        echo -e "  ${GREEN}npm run codegen -- convert:skip-all --retry-folder ${SELECTED_FOLDER} ${INPUT_FILE}${NC}"
        ;;
    *)
        echo -e "  ${YELLOW}Action:${NC}     ${YELLOW}No generation${NC}"
        ;;
esac

echo ""
echo -e "${YELLOW}Full analysis saved to: $ANALYSIS_DEBUG_FILE${NC}"

# If called from test-and-run pipeline, write selected folder to output file
if [ -n "$ANALYSIS_OUTPUT_FILE" ] && [ -n "$SELECTED_FOLDER" ]; then
    echo "$SELECTED_FOLDER" > "$ANALYSIS_OUTPUT_FILE"
fi

rm -f "$ANALYSIS_FILE"