#!/bin/bash

# Test Automation Script - Converts Playwright spec files to Cucumber tests
# using Claude Code with Juspay Grid

set -e

# Enable nullglob so unmatched globs expand to nothing instead of literal strings
shopt -s nullglob

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Returns the next available NN prefix for files matching a glob pattern in a directory
# Usage: next_prefix=$(get_next_prefix "/path/to/dir" "*.feature")
get_next_prefix() {
    local dir="$1"
    local pattern="$2"
    local max_num=0
    mkdir -p "$dir"
    for f in "$dir"/[0-9][0-9]_$pattern; do
        [ -e "$f" ] || continue
        local num=$(basename "$f" | grep -oE '^[0-9]+')
        if [ $((10#$num)) -gt $((10#$max_num)) ]; then
            max_num=$((10#$num))
        fi
    done
    printf "%02d" $((max_num + 1))
}

# Helper: returns the folder name with a number prefix, adding one only if not already present
ensure_prefix() {
    local dir="$1"
    local name="$2"
    if [[ "$name" =~ ^[0-9]+_ ]]; then
        echo "$name"
    else
        local next_num
        next_num=$(get_next_prefix "$dir" "*/")
        echo "${next_num}_${name}"
    fi
}

echo "=========================================="
echo "  Xyne Automation - Test Automator"
echo "=========================================="
echo ""

# Function to check if Claude Code is installed
check_claude_code() {
    if command -v claude &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Check and setup Claude
echo "Checking for Claude Code installation..."
echo ""

if check_claude_code; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✓ Claude Code is already installed!${NC}"
    echo "  Version: ${CLAUDE_VERSION}"
else
    echo -e "${RED}✗ Claude Code is not installed.${NC}"
    echo -e "${YELLOW}Please install Claude Code manually before running this script.${NC}"
    echo -e "${YELLOW}Refer to scripts/playwright-to-cucumber/QUICK_START.md for installation instructions.${NC}"
    echo -e "${YELLOW}Or run: brew install --cask claude-code${NC}"
    exit 1
fi

echo ""
echo "=========================================="
echo "  Configuring Claude with Juspay Grid"
echo "=========================================="
echo ""

# Load environment variables from .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -o allexport
    source "$SCRIPT_DIR/.env"
    set +o allexport
fi

# Claude Code - Juspay Grid configuration
# Set your API key in .env file as JUSPAY_API_KEY=your_api_key (do NOT include 'Bearer') or export as environment variable
if [ -z "$JUSPAY_API_KEY" ]; then
    echo -e "${RED}Error: JUSPAY_API_KEY is not set.${NC}"
    echo -e "${YELLOW}Set it in $SCRIPT_DIR/.env or export it as an environment variable.${NC}"
    echo -e "${YELLOW}Example: export JUSPAY_API_KEY=your_api_key_here${NC}"
    exit 1
fi
export JUSPAY_API_KEY="Bearer $JUSPAY_API_KEY"
# export MODEL="glm-latest"
export MODEL="kimi-latest"

echo -e "${GREEN}✓ Configured with model: ${MODEL}${NC}"
echo -e "${GREEN}✓ Using Juspay Grid API${NC}"
echo ""

# Parse arguments to check for dry-run report flag and retry folder
DRY_RUN_REPORT_FILE=""
RETRY_FOLDER=""
SPEC_FILE_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run-report)
            DRY_RUN_REPORT_FILE="$2"
            shift 2
            ;;
        --retry-folder)
            RETRY_FOLDER="$2"
            shift 2
            ;;
        *)
            SPEC_FILE_ARGS+=("$1")
            shift
            ;;
    esac
done

# Restore positional parameters
set -- "${SPEC_FILE_ARGS[@]}"

# Check if files are provided as arguments
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No Playwright spec files provided.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen -- <file1.spec.ts> [file2.spec.ts ...]"
    echo "  npm run codegen -- --dry-run-report <report-file> <file.spec.ts>"
    echo ""
    echo "Examples:"
    echo "  npm run codegen -- test-1.spec.ts"
    echo "  npm run codegen -- test-1.spec.ts test-2.spec.ts"
    echo "  npm run codegen -- ../tests/*.spec.ts"
    echo "  npm run codegen -- --dry-run-report path/to/report.txt test-1.spec.ts"
    exit 1
fi

if [ -n "$DRY_RUN_REPORT_FILE" ]; then
    if [ -f "$DRY_RUN_REPORT_FILE" ]; then
        echo -e "${YELLOW}Using dry-run failure report for correction:${NC} ${CYAN}$DRY_RUN_REPORT_FILE${NC}"

        if [ -z "$RETRY_FOLDER" ]; then
            echo -e "${YELLOW}  Attempting to auto-detect folder from dry-run report...${NC}"

            # Try to extract feature file path from dry-run report content
            DETECTED_FEATURE=$(grep -oE 'tests/03_e2e/[0-9]+_[a-zA-Z0-9_-]+/[0-9]+_[a-zA-Z0-9_-]+\.feature' "$DRY_RUN_REPORT_FILE" 2>/dev/null | head -1 || true)

            if [ -n "$DETECTED_FEATURE" ]; then
                # Extract folder from feature path (e.g., tests/03_e2e/08_chat/01_test-6.feature -> 08_chat)
                DETECTED_FOLDER=$(echo "$DETECTED_FEATURE" | sed -E 's|tests/03_e2e/([^/]+)/.*|\1|')
                echo -e "${GREEN}✓ Auto-detected folder: ${CYAN}$DETECTED_FOLDER${NC}"
                echo -e "${GREEN}✓ Auto-detected feature: ${CYAN}$DETECTED_FEATURE${NC}"
                RETRY_FOLDER="$DETECTED_FOLDER"
            else
                echo -e "${RED}✗ Could not auto-detect folder from dry-run report.${NC}"
                echo -e "${CYAN}Hint:${NC} Use --retry-folder to specify the folder explicitly."
                echo -e "${CYAN}Example:${NC} --retry-folder 09_chat-settings"
            fi
        else
            echo -e "${GREEN}✓ Retry folder provided:${NC} ${CYAN}$RETRY_FOLDER${NC}"
        fi
        echo ""
    else
        echo -e "${RED}Warning: Dry-run report file not found:${NC} ${CYAN}$DRY_RUN_REPORT_FILE${NC}"
        DRY_RUN_REPORT_FILE=""
    fi
fi

# Process each file
SUCCESS_COUNT=0
FAILED_COUNT=0
FAILED_FILES=()
FINAL_FEATURE_PATHS=()
FINAL_STEPS_PATHS=()

for INPUT_FILE in "$@"; do
    echo "=========================================="
    echo "  Processing: $INPUT_FILE"
    echo "=========================================="
    echo ""

    # Check if file exists (try both relative and absolute paths)
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
        echo -e "${CYAN}Tried: $INPUT_FILE, $AUTOMATION_DIR/$INPUT_FILE, $AUTOMATION_DIR/../$INPUT_FILE${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        echo ""
        continue
    fi

    # Read file content
    echo -e "${CYAN}Reading file...${NC}"
    PLAYWRIGHT_CONTENT=$(cat "$ABSOLUTE_PATH")

    if [ -z "$PLAYWRIGHT_CONTENT" ]; then
        echo -e "${RED}✗ File is empty: $INPUT_FILE${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        echo ""
        continue
    fi

    echo -e "${GREEN}✓ File loaded successfully${NC}"
    echo ""

    # Set BASE_NAME for file path generation
    BASE_NAME=$(basename "$INPUT_FILE" .spec.ts)
    echo -e "${CYAN}Base name for output: $BASE_NAME${NC}"
    echo ""

    # ============================================================
    # STEP 1: Ask LLM for folder placement recommendation (skip if retry)
    # ============================================================
    E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"
    cd "$E2E_DIR"

    OUTPUT_FOLDER=""
    OUTPUT_FOLDER_ABS=""

    # If this is a retry with known folder, skip folder analysis
    if [ -n "$RETRY_FOLDER" ] && [ -d "$E2E_DIR/$RETRY_FOLDER" ]; then
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}Retry mode detected - using previous folder${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        OUTPUT_FOLDER="$RETRY_FOLDER"
        OUTPUT_FOLDER_ABS="$E2E_DIR/$OUTPUT_FOLDER"
        echo -e "${GREEN}✓ Using retry folder:${NC} ${CYAN}tests/03_e2e/${OUTPUT_FOLDER}${NC}"
        echo ""
    else
        # Normal mode: Scan existing e2e folder structure
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}Scanning existing test structure...${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
    
    E2E_STRUCTURE=""
    for folder in */; do
        [ -d "$folder" ] || continue
        folder_name=$(basename "$folder")
        [[ "$folder_name" == _* ]] && continue
        [[ "$folder_name" == "node_modules" ]] && continue
        
        E2E_STRUCTURE="${E2E_STRUCTURE}${folder_name}/\n"
        
        for feat in "$folder"*.feature; do
            [ -e "$feat" ] || continue
            feat_name=$(basename "$feat")
            scenarios=$(grep -E '^\s*(Scenario|Scenario Outline):' "$feat" 2>/dev/null | sed -E 's/^\s*(Scenario|Scenario Outline):\s*//' || true)
            if [ -n "$scenarios" ]; then
                E2E_STRUCTURE="${E2E_STRUCTURE}  ${feat_name}\n"
                while IFS= read -r scn; do
                    E2E_STRUCTURE="${E2E_STRUCTURE}    - ${scn}\n"
                done <<< "$scenarios"
            fi
        done
        E2E_STRUCTURE="${E2E_STRUCTURE}\n"
    done

    # Create LLM prompt for folder placement analysis
    FOLDER_ANALYSIS_PROMPT=$(mktemp)
    cat > "$FOLDER_ANALYSIS_PROMPT" << 'FOLDER_ANALYSIS_EOF'
You are a test organization expert. Analyze the Playwright spec file and existing test structure to recommend WHERE to place the converted BDD test files.

## Task:
1. Identify what feature/functionality the Playwright test covers
2. Check if any existing folder already contains similar scenarios
3. Calculate similarity percentage for each matching folder
4. Recommend the best folder OR suggest a new folder name

## Existing e2e folder structure:
```
FOLDER_ANALYSIS_EOF

    echo -e "$E2E_STRUCTURE" >> "$FOLDER_ANALYSIS_PROMPT"
    
    cat >> "$FOLDER_ANALYSIS_PROMPT" << 'FOLDER_ANALYSIS_EOF2'
```

## Playwright spec file:
```typescript
FOLDER_ANALYSIS_EOF2

    cat "$ABSOLUTE_PATH" >> "$FOLDER_ANALYSIS_PROMPT"
    
    cat >> "$FOLDER_ANALYSIS_PROMPT" << 'FOLDER_ANALYSIS_EOF3'
```

## Output Format (MUST follow exactly):
```json
{
  "analysis": "Brief description of what this test does",
  "matches": [
    {
      "folder": "folder_name",
      "similarity_percentage": 85,
      "reason": "Why this folder matches",
      "matching_scenarios": ["scenario 1", "scenario 2"]
    }
  ],
  "recommendation": {
    "action": "use_existing | create_new",
    "folder_name": "recommended_folder_name",
    "new_folder_suggestion": "suggested-new-name (if action is create_new)",
    "rationale": "Why this recommendation"
  }
}
```

**Rules:**
- similarity_percentage: 0-100, based on test names, selectors (testids), URLs, and actions
- 80-100%: Very similar, likely same feature
- 50-79%: Related feature area
- 0-49%: Different feature
- If no folder has >50% similarity, recommend creating a new folder
- new_folder_suggestion should be kebab-case, lowercase, descriptive
FOLDER_ANALYSIS_EOF3

    echo -e "${CYAN}Asking LLM to analyze folder placement...${NC}"
    
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
        echo -e "${RED}✗ LLM folder analysis failed${NC}"
        echo -e "${YELLOW}  Check debug output: $FOLDER_DEBUG_FILE${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        continue
    fi
    
    # Display LLM analysis to user
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}LLM Analysis Results:${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    cat "$FOLDER_ANALYSIS_FILE"
    echo ""
    echo -e "${YELLOW}File: $FOLDER_DEBUG_FILE${NC}"
    echo ""

    # ============================================================
    # STEP 2: Ask user for decision
    # ============================================================
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}The LLM identified the above-mentioned folders and files as having similarities.${NC}"
    echo -e "${YELLOW}What would you like to do?${NC}"
    echo -e "  ${CYAN}1)${NC} Skip conversion (keep existing tests)"
    echo -e "  ${CYAN}2)${NC} Use LLM's recommended folder"
    echo -e "  ${CYAN}3)${NC} Choose a different existing folder"
    echo -e "  ${CYAN}4)${NC} Create a new folder with custom name"
    echo ""
    echo -n -e "${YELLOW}Choose [1/2/3/4]: ${NC}"
    read -r USER_DECISION
    
    # Trim whitespace
    USER_DECISION=$(echo "$USER_DECISION" | tr -d '[:space:]')
    
    if [ "$USER_DECISION" = "1" ]; then
        echo -e "${CYAN}Skipping conversion for: $INPUT_FILE${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        echo ""
        continue
    elif [ "$USER_DECISION" = "2" ]; then
        # Extract all folder matches from LLM output and show them to user
        echo ""
        echo -e "${YELLOW}LLM found multiple potential folders. Choose one:${NC}"
        
        # Extract all folder names from matches array
        folder_idx=1
        declare -a FOLDER_OPTIONS
        declare -a FOLDER_SIMILARITIES
        
        # Parse JSON matches array
        while IFS= read -r match_line; do
            folder_match=$(echo "$match_line" | grep -oE '"folder"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
            similarity=$(echo "$match_line" | grep -oE '"similarity_percentage"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' || echo "0")
            
            if [ -n "$folder_match" ] && [ "$similarity" -gt 0 ]; then
                # Check if folder exists
                if [ -d "$E2E_DIR/$folder_match" ]; then
                    FOLDER_OPTIONS[$folder_idx]="$folder_match"
                    FOLDER_SIMILARITIES[$folder_idx]="$similarity"
                    echo -e "  ${CYAN}${folder_idx})${NC} ${folder_match} ${YELLOW}(${similarity}% match)${NC}"
                    folder_idx=$((folder_idx + 1))
                fi
            fi
        done < <(grep -A 10 '"matches"' "$FOLDER_ANALYSIS_FILE" | grep -E '"folder"|"similarity_percentage"')
        
        # Add recommended folder from recommendation section
        RECOMMENDED_FOLDER=$(grep -oE '"folder_name"[[:space:]]*:[[:space:]]*"[^"]+"' "$FOLDER_ANALYSIS_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
        if [ -n "$RECOMMENDED_FOLDER" ] && [ -d "$E2E_DIR/$RECOMMENDED_FOLDER" ]; then
            # Check if not already in list
            if [[ ! " ${FOLDER_OPTIONS[@]} " =~ " ${RECOMMENDED_FOLDER} " ]]; then
                FOLDER_OPTIONS[$folder_idx]="$RECOMMENDED_FOLDER"
                FOLDER_SIMILARITIES[$folder_idx]="recommended"
                echo -e "  ${CYAN}${folder_idx})${NC} ${RECOMMENDED_FOLDER} ${GREEN}(LLM recommended)${NC}"
                folder_idx=$((folder_idx + 1))
            fi
        fi
        
        # If no matches found, try new folder suggestion
        if [ ${#FOLDER_OPTIONS[@]} -eq 0 ]; then
            NEW_FOLDER_SUGGESTION=$(grep -oE '"new_folder_suggestion"[[:space:]]*:[[:space:]]*"[^"]+"' "$FOLDER_ANALYSIS_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
            if [ -n "$NEW_FOLDER_SUGGESTION" ]; then
                echo -e "${YELLOW}LLM recommends creating a new folder: ${CYAN}${NEW_FOLDER_SUGGESTION}${NC}"
                echo -e "${YELLOW}Creating new folder...${NC}"
                OUTPUT_FOLDER=$(ensure_prefix "$E2E_DIR" "$NEW_FOLDER_SUGGESTION")
                OUTPUT_FOLDER_ABS="$E2E_DIR/$OUTPUT_FOLDER"
                mkdir -p "$OUTPUT_FOLDER_ABS"
                echo -e "${GREEN}✓ Created new folder:${NC} ${CYAN}tests/03_e2e/${OUTPUT_FOLDER}${NC}"
            else
                echo -e "${RED}Could not parse LLM recommendation. Please choose option 3 or 4.${NC}"
                exit 1
            fi
        else
            echo ""
            echo -n -e "${YELLOW}Select folder number: ${NC}"
            read -r FOLDER_NUM
            FOLDER_NUM=$(echo "$FOLDER_NUM" | tr -d '[:space:]')
            
            if [ "$FOLDER_NUM" -ge 1 ] && [ "$FOLDER_NUM" -lt "$folder_idx" ]; then
                OUTPUT_FOLDER="${FOLDER_OPTIONS[$FOLDER_NUM]}"
                OUTPUT_FOLDER_ABS="$E2E_DIR/$OUTPUT_FOLDER"
                echo -e "${GREEN}✓ Selected folder:${NC} ${CYAN}tests/03_e2e/${OUTPUT_FOLDER}${NC}"
            else
                echo -e "${RED}Invalid selection. Exiting.${NC}"
                exit 1
            fi
        fi
    elif [ "$USER_DECISION" = "3" ]; then
        echo ""
        echo -e "${YELLOW}Available folders (including subfolders):${NC}"
        folder_idx=1
        declare -a FOLDER_OPTIONS
        
        # Find all folders (including subfolders) that contain .feature files or steps
        while IFS= read -r folder_path; do
            # Get relative path from E2E_DIR
            folder_rel=$(python3 -c "import os; print(os.path.relpath('$folder_path', '$E2E_DIR'))" 2>/dev/null || basename "$folder_path")
            [[ "$folder_rel" == _* ]] && continue
            [[ "$folder_rel" == "node_modules" ]] && continue
            [[ "$folder_rel" == *"/_previous"* ]] && continue
            
            # Check if folder has .feature files or steps directory
            if [ -n "$(find "$folder_path" -maxdepth 1 -name "*.feature" -o -type d -name "steps" 2>/dev/null)" ]; then
                FOLDER_OPTIONS[$folder_idx]="$folder_rel"
                echo -e "  ${CYAN}${folder_idx})${NC} ${folder_rel}"
                folder_idx=$((folder_idx + 1))
            fi
        done < <(find "$E2E_DIR" -type d -not -path "*/node_modules/*" -not -path "*/_previous/*" 2>/dev/null | sort)
        
        echo ""
        echo -n -e "${YELLOW}Select folder number: ${NC}"
        read -r FOLDER_NUM
        FOLDER_NUM=$(echo "$FOLDER_NUM" | tr -d '[:space:]')
        
        if [ "$FOLDER_NUM" -ge 1 ] && [ "$FOLDER_NUM" -lt "$folder_idx" ]; then
            OUTPUT_FOLDER="${FOLDER_OPTIONS[$FOLDER_NUM]}"
            OUTPUT_FOLDER_ABS="$E2E_DIR/$OUTPUT_FOLDER"
            echo -e "${GREEN}✓ Selected folder:${NC} ${CYAN}tests/03_e2e/${OUTPUT_FOLDER}${NC}"
        else
            echo -e "${RED}Invalid selection. Exiting.${NC}"
            exit 1
        fi
    elif [ "$USER_DECISION" = "4" ]; then
        echo ""
        echo -e "${YELLOW}Enter new folder name (without number prefix):${NC}"
        echo -e "${YELLOW}Example: user-settings, direct-messages, calls${NC}"
        echo -n -e "${YELLOW}Folder name: ${NC}" >&2
        read -r NEW_FOLDER_NAME < /dev/tty
        
        if [ -z "$NEW_FOLDER_NAME" ]; then
            echo -e "${RED}Folder name cannot be empty. Exiting.${NC}"
            exit 1
        fi
        
        if ! [[ "$NEW_FOLDER_NAME" =~ ^[a-z0-9-]+$ ]]; then
            echo -e "${RED}Invalid folder name. Use lowercase letters, numbers, and hyphens only.${NC}"
            exit 1
        fi
        
        OUTPUT_FOLDER=$(ensure_prefix "$E2E_DIR" "$NEW_FOLDER_NAME")
        OUTPUT_FOLDER_ABS="$E2E_DIR/$OUTPUT_FOLDER"
        mkdir -p "$OUTPUT_FOLDER_ABS"
        echo -e "${GREEN}✓ Created new folder:${NC} ${CYAN}tests/03_e2e/${OUTPUT_FOLDER}${NC}"
    else
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Final output location: tests/03_e2e/${OUTPUT_FOLDER}${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    fi  # End of retry check - closes the if-else for RETRY_FOLDER
    # ============================================================

    cd "$AUTOMATION_DIR"
    echo ""

    SPEC_BASENAME=$(basename "$ABSOLUTE_PATH")

    # Scan existing feature and steps files in the output folder
    if [ -n "$OUTPUT_FOLDER_ABS" ] && [ -d "$OUTPUT_FOLDER_ABS" ]; then
        EXISTING_FEATURES_DIR="$OUTPUT_FOLDER_ABS"
    else
        EXISTING_FEATURES_DIR="$AUTOMATION_DIR/tests/03_e2e/${OUTPUT_FOLDER}"
    fi
    EXISTING_STEPS_DIR="$EXISTING_FEATURES_DIR/steps"
    EXISTING_FEATURE_FILES=()
    EXISTING_STEPS_FILES=()
    EXISTING_FEATURE_NAMES=()
    EXISTING_STEPS_NAMES=()

    if [ -d "$EXISTING_FEATURES_DIR" ]; then
        while IFS= read -r ef; do
            [ -e "$ef" ] || continue
            EXISTING_FEATURE_FILES+=("$ef")
            EXISTING_FEATURE_NAMES+=("$(basename "$ef")")
            echo -e "${CYAN}Found existing feature: $(basename "$ef")${NC}"
        done < <(find "$EXISTING_FEATURES_DIR" -name "*.feature" -not -path "*/_previous/*" -not -path "*/node_modules/*" -type f 2>/dev/null)
    fi
    if [ -d "$EXISTING_FEATURES_DIR" ]; then
        while IFS= read -r es; do
            [ -e "$es" ] || continue
            EXISTING_STEPS_FILES+=("$es")
            EXISTING_STEPS_NAMES+=("$(basename "$es")")
            echo -e "${CYAN}Found existing steps: $(basename "$es")${NC}"
        done < <(find "$EXISTING_FEATURES_DIR" -name "*.steps.ts" -not -path "*/_previous/*" -not -path "*/node_modules/*" -type f 2>/dev/null)
    fi

    # ============================================================
    # STEP 3: Check for existing scenarios and ask LLM for similarity analysis
    # ============================================================
    if [ ${#EXISTING_FEATURE_FILES[@]} -gt 0 ] || [ ${#EXISTING_STEPS_FILES[@]} -gt 0 ]; then
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
        echo -e "${YELLOW}Existing files detected in ${OUTPUT_FOLDER}${NC}" >&2
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
        echo "" >&2

        # Create LLM prompt for scenario similarity analysis
        SCENARIO_ANALYSIS_PROMPT=$(mktemp)
        cat > "$SCENARIO_ANALYSIS_PROMPT" << 'SCENARIO_ANALYSIS_EOF'
You are a test coverage expert. Compare the Playwright spec file against existing Cucumber scenarios to calculate coverage percentage.

## Task:
1. Identify all test cases in the Playwright spec file
2. For each test case, check if it's already covered in existing scenarios
3. Calculate percentage of coverage (0-100%)
4. List which scenarios are covered and which are new

## Playwright spec file:
```typescript
SCENARIO_ANALYSIS_EOF

        cat "$ABSOLUTE_PATH" >> "$SCENARIO_ANALYSIS_PROMPT"
        
        cat >> "$SCENARIO_ANALYSIS_PROMPT" << 'SCENARIO_ANALYSIS_EOF2'
```

## Existing Cucumber scenarios in this folder:
SCENARIO_ANALYSIS_EOF2

        for ef in "${EXISTING_FEATURE_FILES[@]}"; do
            echo "" >> "$SCENARIO_ANALYSIS_PROMPT"
            echo "### $(basename "$ef")" >> "$SCENARIO_ANALYSIS_PROMPT"
            echo '```gherkin' >> "$SCENARIO_ANALYSIS_PROMPT"
            cat "$ef" >> "$SCENARIO_ANALYSIS_PROMPT"
            echo '```' >> "$SCENARIO_ANALYSIS_PROMPT"
        done
        
        cat >> "$SCENARIO_ANALYSIS_PROMPT" << 'SCENARIO_ANALYSIS_EOF3'

## Output Format (MUST follow exactly):
```json
{
  "coverage_percentage": 75,
  "analysis": "Brief summary of coverage",
  "covered_scenarios": [
    {
      "playwright_test": "test name from spec",
      "covered_by": "existing scenario name",
      "confidence": "high | medium | low"
    }
  ],
  "new_scenarios": [
    {
      "playwright_test": "test name from spec",
      "reason": "why it's not covered"
    }
  ],
  "recommendation": "skip | update | regenerate_all"
}
```

**Rules:**
- coverage_percentage: 0-100, based on how many test cases are already covered
- confidence: high (exact match), medium (similar), low (partial match)
- recommendation:
  - skip: 100% coverage, all tests already exist
  - update: 1-99% coverage, add missing scenarios to existing files
  - regenerate_all: 0% coverage or scenarios are very different
SCENARIO_ANALYSIS_EOF3

        echo -e "${CYAN}Asking LLM to analyze scenario coverage...${NC}" >&2
        
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
            echo -e "${YELLOW}⚠ LLM scenario analysis failed, using manual comparison${NC}" >&2
        else
            # Display LLM analysis
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
            echo -e "${CYAN}LLM Scenario Coverage Analysis:${NC}" >&2
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
            echo "" >&2
            cat "$SCENARIO_ANALYSIS_FILE" >&2
            echo "" >&2
        fi

        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
        echo -e "${YELLOW}What would you like to do?${NC}" >&2
        echo -e "  ${CYAN}1)${NC} Skip — keep existing files, do not generate anything" >&2
        echo -e "  ${CYAN}2)${NC} Update — only generate scenarios NOT already covered" >&2
        echo -e "  ${CYAN}3)${NC} Regenerate all — generate all scenarios into NEW files" >&2
        echo "" >&2
        echo -n -e "${YELLOW}Choose [1/2/3]: ${NC}" >&2
        read -r REGEN_CHOICE < /dev/tty

        USER_ACTION=""
        if [ "$REGEN_CHOICE" = "1" ]; then
            echo -e "${CYAN}Skipping generation — keeping existing files.${NC}" >&2
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            EXISTING_FEATURE_ABS="${EXISTING_FEATURE_FILES[0]:-}"
            EXISTING_STEPS_ABS="${EXISTING_STEPS_FILES[0]:-}"
            FINAL_FEATURE_PATHS+=("${EXISTING_FEATURE_ABS}")
            FINAL_STEPS_PATHS+=("${EXISTING_STEPS_ABS}")
            echo -e "  ${YELLOW}Feature:${NC} ${CYAN}${EXISTING_FEATURE_ABS}${NC}" >&2
            echo -e "  ${YELLOW}Steps:${NC}   ${CYAN}${EXISTING_STEPS_ABS}${NC}" >&2
            echo "" >&2
            continue
        elif [ "$REGEN_CHOICE" = "3" ]; then
            echo -e "${CYAN}Regenerating all scenarios — existing files will NOT be modified.${NC}" >&2
            USER_ACTION="regenerate_all"
            EXISTING_FEATURE_FILES=()
            EXISTING_STEPS_FILES=()
            EXISTING_FEATURE_NAMES=()
            EXISTING_STEPS_NAMES=()
            echo "" >&2
        else
            echo -e "${CYAN}Adding only new scenarios — LLM will skip already-covered test cases.${NC}" >&2
            USER_ACTION="update"
            echo "" >&2
        fi
    fi

    # Also scan ALL other e2e folders for scenario names to detect cross-folder duplicates
    ALL_E2E_SCENARIOS=""
    for other_folder in "$AUTOMATION_DIR/tests/03_e2e"/*/; do
        [ -d "$other_folder" ] || continue
        other_folder_name=$(basename "$other_folder")
        # Skip the current output folder — already handled above
        [ "$other_folder_name" = "$OUTPUT_FOLDER" ] && continue
        for other_feature in "$other_folder"/*.feature; do
            [ -e "$other_feature" ] || continue
            # Extract scenario names from the feature file
            scenarios=$(grep -E '^\s*(Scenario|Scenario Outline):' "$other_feature" 2>/dev/null | sed -E 's/^\s*(Scenario|Scenario Outline):\s*//' || true)
            if [ -n "$scenarios" ]; then
                ALL_E2E_SCENARIOS="${ALL_E2E_SCENARIOS}\n# From ${other_folder_name}/$(basename "$other_feature"):\n${scenarios}\n"
            fi
        done
    done

    echo ""

    # Create prompt file using heredoc to avoid shell interpretation issues
    TEMP_PROMPT_FILE=$(mktemp)
    cat > "$TEMP_PROMPT_FILE" << 'PROMPT_EOF'
You are a test automation expert. Convert the following Playwright test into Cucumber BDD format for the xyne-automation framework.

**CRITICAL: ALWAYS OUTPUT CODE BLOCKS.** The automation script parses your output for code blocks. If you do not output code blocks, the pipeline will fail. Never say "the test already exists" or "no new files needed" — always generate and output the complete files.

## RULES:

### Rule 1 — Feature File Completeness & Faithfulness
- The .feature file MUST include EVERY step from the Playwright test, in exact order.
- NEVER skip, merge, or deduplicate steps that look similar. If the Playwright test clicks 3 different buttons, the feature file must have 3 separate click steps.
- **CRITICAL — 1:1 Mapping**: Each Playwright action (click, fill, goto, waitFor, etc.) MUST map to exactly ONE step in the feature file. Do NOT:
  - Invent actions that do not exist in the spec file (e.g., do NOT add a "create" click when the spec clicks "Cancel")
  - Replace one action with a different action (e.g., do NOT replace `getByRole('button', { name: 'Cancel' }).click()` with a click on a different button)
  - Skip actions from the spec file
  - Reorder actions from the spec file
  - **Revert selectors**: If the spec uses `getByTestId('dm-message-input')`, you MUST output `I click on "[data-testid='dm-message-input']"` — do NOT convert it back to a role/text/label selector like `I click the textbox with name "Message (optional)"`. The spec file is the single source of truth.
- **Verify**: After generating, mentally walk through the spec file line by line and confirm every action has a matching step in the same order. If the spec says `.click()` on element X, the feature file MUST click on element X — not element Y.
- Use the EXACT step phrases from the QUICK REFERENCE list (provided below) character-for-character. Do NOT rephrase, reorder words, or add/remove words.
- String parameters (browser names, selectors, etc.) MUST be in double "quotes" in the .feature file.

### Rule 2 — Steps File: No Duplicates (GLOBAL scope)
- Your .steps.ts file must NOT contain ANY step definition whose pattern already exists ANYWHERE in the project — this includes shared step files (common.steps.ts, browser.steps.ts, e2e-common.steps.ts) AND step files in OTHER e2e test folders.
- Cucumber loads ALL step files globally. A step defined in `05_tickets/steps/01_test.steps.ts` is visible to tests in `07_call/`. Redefining the same step pattern causes "Multiple step definitions match" errors that break the ENTIRE test suite.
- BEFORE writing any step definition, check the EXISTING SHARED STEP DEFINITIONS section in the prompt (provided dynamically). If the pattern is there, DO NOT define it.
- If a step you need is already defined, just USE it in your .feature file — do NOT redefine it.

**USER REFERENCE RESOLUTION — Required for all steps with text input**:

When creating ANY step that accepts text which may contain `user:xxx-browser.xxx` patterns (like typing, clicking on text, assertions), you MUST include the resolution logic:

```typescript
// Always include this resolution logic for text parameters
const resolvedText = text.replace(
  /user:([^.,\s]+)\.([^,\s]+)/g,
  (match, browserSession, field) => {
    for (const [, userData] of this.userData) {
      if (userData.browserSession === browserSession) {
        return userData[field as keyof typeof userData] as string;
      }
    }
    throw new Error(`No user found logged in browser session "\${browserSession}"`);
  }
);
// Then use resolvedText instead of text
```

**Example steps that need user resolution**:
- `I type {string} on the element {string}` — Resolve text before filling
- `I type {string} using keyboard` — Resolve text before typing
- `I click on text {string}` — Resolve text before clicking
- `I should see {string} in the element {string}` — Resolve text before assertion
- Any step that uses `user:xxx-browser.xxx` pattern in the feature file

### Rule 3 — Steps File: Define All New Steps
- For EVERY step phrase in the .feature file that is NOT in the QUICK REFERENCE list, you MUST generate a matching step definition in the .steps.ts file.
- The step definition string must match the feature file step phrase EXACTLY, character for character.
- The step definition body MUST use the equivalent Playwright API method. For example, if the spec calls `.keyboard.press(...)`, your step definition must call `this.page.keyboard.press(...)`. If the spec calls `.locator(...).press(...)`, your step must call `this.page.locator(selector).press(...)`. Always use `this.page` (from CustomWorld) — never `page` directly.
- This applies to ALL Playwright actions: keyboard, mouse, drag-and-drop, hover, focus, selectOption, check, uncheck, dblclick, scroll, file upload, etc. Whatever Playwright method the spec uses, your step definition must use the same method via `this.page`.
- Even if all steps exist in shared files, you MUST still output a .steps.ts file (it can be minimal with just imports).

### Rule 4 — Faithful Selector Conversion (NEVER invent data-testid)
**Convert selectors EXACTLY as they appear in the spec file. NEVER invent or fabricate selectors.**
**NEVER reverse-engineer a getByTestId() back to its original role/text/label form.**

| Playwright spec uses | Convert to (feature file) |
|---|---|
| `page.getByTestId('foo')` | `I click on "[data-testid='foo']"` |
| `page.getByTestId('foo').fill('val')` | `I type "val" on the element "[data-testid='foo']"` |
| `page.getByTestId('foo').click()` then `page.getByTestId('foo').fill('val')` | TWO steps: `I click on "[data-testid='foo']"` AND `I type "val" on the element "[data-testid='foo']"` |
| `page.getByText('some text')` | `I click on text "some text"` |
| `page.getByRole('button', { name: 'Cancel' })` | `I click the button with text "Cancel"` |
| `page.getByRole('paragraph')` | Use an existing shared step or create a new one |
| `page.click('text="some text"')` | `I click on text "some text"` |
| `page.fill('selector', 'value')` | `I type "value" on the element "selector"` |
| `page.keyboard.press('<key>')` | `I press the "<key>" key` |
| `page.keyboard.type('<text>')` | `I type "<text>" using keyboard` |
| `page.locator('sel').press('<key>')` | `I press the "<key>" key on the element "sel"` |
| `page.waitForSelector('sel')` | `I wait for "sel" to be visible` |
| `expect(locator).toBeVisible()` | `I wait for "sel" to be visible` |
| `page.waitForURL('**/path')` | `I wait for the URL to contain "/path"` |
| **User search pattern** (DM creation, add member) | **Use search-first-then-select pattern** |
| `page.fill('#search', 'email')` then `page.getByText('Name').click()` | `I type "user:target-browser.email" on the element "#search"` AND `I click on text "user:target-browser.name" in the element "[data-testid='user-search-results']"` |
| **Search trigger pattern** (click to open, then type) | **Use keyboard typing after click** |
| `page.getByTestId('search-trigger').click()` then `page.keyboard.type('text')` | `I click on "[data-testid='search-trigger']"` AND `I type "text" using keyboard` |
| **User name in getByText** (person's name) | **Use dynamic user reference** |
| `page.getByText('John Doe')` or `page.getByText('Naveen Yallattikar')` | `I click on text "user:<target-browser>.name"` (NEVER hardcode names!) |
| **User email in fill** | **Use dynamic user reference** |
| `page.fill('#search', 'john@example.com')` | `I type "user:<target-browser>.email" on the element "#search"` (NEVER hardcode emails!) |
| **Global keyboard shortcut** (ControlOrMeta+k, Escape) | **Use `body` element** |
| `page.getByTestId('message-input').press('ControlOrMeta+k')` | `I press the "ControlOrMeta+k" key on the element "body"` (global shortcuts use body!) |

**CRITICAL — Global Keyboard Shortcuts**: Shortcuts like `ControlOrMeta+k` are global and should be pressed on `body`, not on specific elements:
- ❌ `And I press the "ControlOrMeta+k" key on the element "[data-testid='message-input']"` → WRONG (element may not exist)
- ✅ `And I press the "ControlOrMeta+k" key on the element "body"` → CORRECT (global shortcut)

**CRITICAL — User Name/Email Detection**: If `getByText()`, `fill()`, or `type()` contains what looks like a person's name (e.g., "John Doe", "Naveen Yallattikar", "Admin User") or an email address, you MUST convert it to a dynamic user reference:
- ❌ `And I click on text "Naveen Yallattikar"` → WRONG (hardcoded)
- ✅ `And I click on text "user:admin-browser.name"` → CORRECT (dynamic)
- ❌ `And I type "john@example.com" on the element "#search"` → WRONG (hardcoded)
- ✅ `And I type "user:user2-browser.email" on the element "#search"` → CORRECT (dynamic)

**CRITICAL — Non-Input Elements (Lexical Editor, Rich Text, etc.)**:
Some elements look like inputs but are actually `<div>` containers for rich text editors (Lexical, Quill). The `.fill()` method will FAIL on these with error "Element is not an <input>, <textarea>, <select>".

**Known Non-Input TestIDs (convert to keyboard typing)**:
| TestID | Element Type | Correct Conversion |
|---|---|---|
| `search-textbox` | `<div data-lexical-search-input>` | `I type "text" using keyboard` |
| `user-search-input` | `<input>` | `I type "text" on the element "[data-testid='user-search-input']"` ✅ WORKS |

**Known Working Input TestIDs (use normal fill conversion)**:
| TestID | Element Type | Correct Conversion |
|---|---|---|
| `user-search-input` | Works as input | `I type "text" on the element "[data-testid='user-search-input']"` ✅ |
| `channel-name-input` | Works as input | `I type "text" on the element "[data-testid='channel-name-input']"` ✅ |
| `dm-message-input` | Works as input | `I type "text" on the element "[data-testid='dm-message-input']"` ✅ |

**Special Case - TipTap Editor (message-input)**:
The `message-input` is a TipTap/ProseMirror rich text editor. It has `role="textbox"` and works with `.fill()` in most cases:
```gherkin
And I type "Hello" on the element "[data-testid='message-input']"
```
If `.fill()` fails, the test can click first then type:
```gherkin
And I click on "[data-testid='message-input']"
And I type "Hello" using keyboard
```

**RULE: When you see `search-textbox` in the spec, ALWAYS convert to keyboard typing**:
```typescript
// Playwright spec
await page.getByTestId('search-textbox').fill('test');
```
**CORRECT conversion**:
```gherkin
And I type "test" using keyboard
```
**WRONG conversion**:
```gherkin
And I type "test" on the element "[data-testid='search-textbox']"  # FAILS - it's a <div>!
```

**CRITICAL — Text to TestID Conversion Patterns**:

Many elements have dynamic testids based on their text content. Learn the **patterns**, not hardcoded values:

**Pattern 1: Status Suggestions** - TestID: `status-suggestion-{normalized-text}`
- TestID format: `status-suggestion-{text-lowercase-with-hyphens}`
- Conversion rule: Remove emoji → lowercase → replace spaces with hyphens → prefix `status-suggestion-`
- Example: `getByText('📅 Some Status')` → `[data-testid='status-suggestion-some-status']`

**Pattern 2: Theme Options** - TestID: `theme-{id}`
- TestID format: `theme-{theme-id}`
- Conversion rule: Use the theme's internal ID (lowercase, underscores allowed)
- Example: `getByText('Some Theme')` → `[data-testid='theme-some-theme']`

**Pattern 3: Tab Buttons** - TestID: `tab-{id}`
- TestID format: `tab-{tab-id}`
- Example: `getByText('SomeTab')` in tab context → `[data-testid='tab-sometab']`

**Pattern 4: Dynamic Titles**:
- DM titles like "Message John Doe" or "John, Jane + 2 others" are dynamic
- NEVER use getByText for these - use testids or verify related elements instead

**Pattern 5: User Display Names with "(you)" suffix**:
- Current user's name may appear as "John Doe (you)"
- NEVER match this text - use testids or `user:<browser>.name` reference

**General Rule for Emoji Text**:
- Emoji may cause encoding/matching issues with `getByText()`
- Always prefer testid over text when emoji is involved
- Convert text to testid using the patterns above
| `page.getByText('Midnight').click()` | `I click on "[data-testid='theme-midnight']"` |

**CRITICAL — User "(you)" Suffix Pattern**:
When displaying the current user, the UI appends "(you)" to their name. NEVER match this text directly:
- ❌ `And I click on text "John Doe (you)"` - WRONG
- ✅ Use the testid or role selector instead, or use `user:<browser>.name` without the suffix

**CRITICAL — Dynamic Conversation Titles**:
DM conversation titles are dynamic (e.g., "Message John Doe" or "John, Jane + 2 others"). NEVER use getByText for these:
- ❌ `And I should see "Message John Doe"` - WRONG (dynamic)
- ✅ Use testids like `[data-testid='dm-header']` or verify message input is visible instead

**CRITICAL — Search Input Pattern**: When a Playwright test clicks on a search trigger/container (like `search-input-content`, `search-trigger`, etc.) and then types, do NOT use `I type on the element` with a container selector. Use keyboard typing instead:
- ✅ CORRECT: `I click on "[data-testid='search-trigger']"` AND `I type "search-term" using keyboard`
- ❌ WRONG: `I click on "[data-testid='search-trigger']"` AND `I type "search-term" on the element "[data-testid='search-textbox']"` (search-textbox is a `<div>` container, not an input)

**CRITICAL**: `getByTestId('dm-message-input')` → `I click on "[data-testid='dm-message-input']"` — NEVER convert this to `I click the textbox with name "Message (optional)"` or any other role/text step. The testid IS the selector.

**NEVER** do this:
- ❌ `getByTestId('dm-message-input')` → `I click the textbox with name "Message (optional)"` (WRONG — reverting testid to role selector)
- ❌ `getByText('John')` → `I click on "[data-testid='john-btn']"` (WRONG — inventing testid that doesn't exist in spec)
- ❌ Clicking search trigger then using `I type on the element` with guessed selector (WRONG — often guesses a container, not input)
- ✅ `getByTestId('dm-message-input')` → `I click on "[data-testid='dm-message-input']"` (CORRECT)
- ✅ `getByTestId('dm-message-input').fill('hello')` → `I type "hello" on the element "[data-testid='dm-message-input']"` (CORRECT)
- ✅ `getByText('hello')` → `I click on text "hello"` (CORRECT — faithful conversion)
- ✅ `getByRole('button', { name: 'Save' })` → `I click the button with text "Save"` (CORRECT — faithful conversion)
- ✅ `page.keyboard.type('text')` → `I type "text" using keyboard` (CORRECT — for search triggers that open input)

### Rule 5 — TypeScript & Null Checks
- Every step using `this.page` must include: `if (!this.page) throw new Error('Browser not initialized');`
- Inside `.catch()`, `.then()`, or callbacks, re-add the null check before using `this.page`.
- The .steps.ts file MUST compile with zero TypeScript errors.
- Use Playwright APIs correctly. Prefer `this.page.locator('selector').click()` over waitForSelector chains.
- Do NOT access properties that do not exist on Config, CustomWorld, Page, or Locator types.

### Rule 5b — Search Input Patterns (CRITICAL)
**Many modern apps use search triggers that open inputs dynamically. When converting such patterns, use keyboard typing instead of guessing input selectors.**

**Problem**: After clicking a search trigger (like `search-input-content`, `search-trigger`, etc.), the LLM often guesses a selector like `search-textbox` which is actually a `<span>` container, not an `<input>` element. This causes `fill()` to fail.

**Recognize these patterns in the Playwright spec**:
```typescript
// Pattern 1: Click then keyboard.type
await page.getByTestId('search-trigger').click();
await page.keyboard.type('search-term');

// Pattern 2: Click container then type
await page.locator('.search-container').click();
await page.keyboard.type('search-term');

// Pattern 3: Click to open modal/input
await page.click('[data-testid="search-input-content"]');
await page.keyboard.type('test');
```

**Correct conversion**:
```gherkin
And I click on "[data-testid='search-trigger']"
And I type "search-term" using keyboard
```

**WRONG conversion** (what to avoid):
```gherkin
# WRONG - search-textbox is a span container, not an input
And I click on "[data-testid='search-trigger']"
And I type "search-term" on the element "[data-testid='search-textbox']"
```

**Key rules for search inputs**:
1. **If spec uses `page.keyboard.type()` after a click** → Use `I type "..." using keyboard`
2. **If spec uses `.fill()` on a specific selector** → Use `I type "..." on the element "..."`
3. **If spec clicks a trigger/container and then types** → Use keyboard typing, do NOT invent an input selector
4. **Common search trigger selectors**: `search-trigger`, `search-input-content`, `search-box`, `.search-container`, `[data-testid="search"]`

**Examples**:

| Playwright Spec | Correct Feature File |
|---|---|
| `page.getByTestId('search-trigger').click(); page.keyboard.type('test')` | `I click on "[data-testid='search-trigger']"` AND `I type "test" using keyboard` |
| `page.locator('#search').fill('query')` | `I type "query" on the element "#search"` |
| `page.click('.search-box'); page.keyboard.type('test')` | `I click on ".search-box"` AND `I type "test" using keyboard` |

### Rule 6 — Dynamic Data (No Hardcoding)
- Use `this.config.dashboard.baseUrl` instead of hardcoded URLs.
- Use `this.config.backend.baseUrl` for backend URLs.
- Use `this.config.timeout` for timeouts.
- Use `this.userData.set()` / `this.userData.get()` to store/retrieve data between steps (with proper null checks).
- Do NOT invent properties like `this.config.testData`.
- Hardcoded values ARE allowed in Scenario Outline Examples tables.
- **CRITICAL — Dynamic user references**: NEVER hardcode user names, emails, or IDs in feature files. Instead use the `user:<browser>.name`, `user:<browser>.email`, or `user:<browser>.id` syntax which resolves dynamically at runtime:
  ```gherkin
  And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
  And I type "user:user1-browser.id" on the element "[data-testid='channel-name-input']"
  ```
  Available browser references: admin-browser, user1-browser, user2-browser, user3-browser
  Available properties: .name, .email, .id
- **CRITICAL — Dynamic selectors**: If a Playwright test references an element by a user-specific string (e.g., `img[name=Naveen Y'']`, `text='John Doe'`, a specific email, a channel name derived from a username), do NOT hardcode that string in the .feature file. Instead:
  - Use the `user:<browser>.name` syntax if the name refers to a known test user
  - Or create a step that dynamically finds the element without relying on a specific name (e.g., "I click on the user avatar" which finds the logged-in user's avatar automatically).
  - In the step definition, resolve dynamic values using `this.userData.get()` or by querying the page for the current user's info.

**FORBIDDEN — NEVER HARDCODE USER NAMES, EMAILS, OR IDS:**
- ❌ `And I click on text "Naveen Yallattikar"` (WRONG — hardcoded name)
- ❌ `And I type "john@example.com" on the element "#search"` (WRONG — hardcoded email)
- ❌ `And I should see "Jane Doe" in the element ".user-list"` (WRONG — hardcoded name)
- ❌ `And I click on text "Admin User"` (WRONG — hardcoded name)

**CORRECT — ALWAYS USE DYNAMIC USER REFERENCES:**
- ✅ `And I click on text "user:admin-browser.name"` (CORRECT)
- ✅ `And I type "user:user2-browser.email" on the element "#search"` (CORRECT)
- ✅ `And I should see "user:user1-browser.name" in the element ".user-list"` (CORRECT)
- ✅ `And I click on text "user:user3-browser.name"` (CORRECT)

**Rule of thumb**: If the text you're clicking on, typing, or asserting looks like a person's name, email address, or user ID — it MUST use the `user:<browser>.*` syntax. The only exception is arbitrary message content or generic labels (like "Hello!", "Save", "Cancel", etc.).

**How to determine which browser reference to use**:
1. If the current browser context is "admin-browser" and clicking on own name → `user:admin-browser.name`
2. If user1 is searching for user2 → `user:user2-browser.email` for search, `user:user2-browser.name` for click
3. If verifying from another user's perspective → use that user's browser reference

### Rule 7 — Structure & Naming (CRITICAL — Browser Reuse & Multi-User Interaction Detection)

**FIRST: Analyze the Playwright spec file to determine the number of users involved:**

1. **Single-user test** — Use "admin-browser" for ALL actions:
   - Spec uses only `page` variable throughout (no `page1`, `page2`, `browser1`, `browser2`)
   - Spec tests individual features (create channel, send message, edit profile, etc.)
   - No verification from another user's perspective
   - Example: `test.describe('Channel Creation', () => { test('create channel', async ({ page }) => { ... }) })`

2. **Multi-user test** — Use appropriate browsers and switch context:
   - Spec has multiple page instances: `page1`, `page2`, `browser1`, `browser2`, or uses `browser.newContext()`
   - Spec verifies actions from multiple user perspectives (e.g., user1 sends message, user2 receives it)
   - Spec involves DM creation, channel member addition, notifications, etc.
   - Example: `test('user1 sends DM to user2', async ({ browser }) => { const user1 = await browser.newContext(); const user2 = await browser.newContext(); ... })`

**BROWSER ASSIGNMENT RULES:**

- **Single-user test**: Use ONLY "admin-browser" for all steps
  ```gherkin
  Background:
    Given using browser "admin-browser"
  ```

- **Multi-user test**: Map spec users to available browsers based on role/context:
  - First user/actor → "admin-browser" (if admin-like actions) or "user1-browser"
  - Second user → "user2-browser"
  - Third user → "user3-browser"
  - Switch context with `Given using browser "xxx-browser"` when actions change between users

**HOW TO DETECT MULTI-USER INTERACTIONS IN THE SPEC:**

Look for these patterns in the Playwright spec:

| Spec Pattern | Indicates Multi-User | Browser Assignment |
|---|---|---|
| `const user1 = await browser.newContext()` | YES | user1-browser |
| `const user2 = await browser.newContext()` | YES | user2-browser |
| `page1.click(...)`, `page2.click(...)` | YES | admin-browser, user2-browser |
| `browser1.newPage()`, `browser2.newPage()` | YES | admin-browser, user2-browser |
| `await page.getByText('User2').click()` in DM flow | YES | user2-browser is the target |
| `test('user1 creates channel and adds user2'...)` | YES | user1-browser (creator), user2-browser (added member) |
| `expect(page2.locator(...)).toBeVisible()` | YES | Verify from user2's perspective |
| Only `page` variable used throughout | NO | Use admin-browser only |
| `test.use({ storageState: 'user1.json' })` | YES | Map to user1-browser |

**MULTI-USER CONVERSION EXAMPLES:**

Example 1 - DM Creation (user1 creates DM with user2, both verify):
```typescript
// Playwright spec
const user1 = await browser.newContext({ storageState: 'user1.json' });
const user2 = await browser.newContext({ storageState: 'user2.json' });
const user1Page = await user1.newPage();
const user2Page = await user2.newPage();

await user1Page.goto('/chat');
await user1Page.getByTestId('create-new-dm').click();
await user1Page.getByTestId('search-input').fill('user2@example.com');
await user1Page.getByText('User Two').click();
await user1Page.getByTestId('message-input').fill('Hello!');
await user1Page.getByTestId('send-button').click();

// Verify user2 received the message
await user2Page.goto('/chat');
await user2Page.getByText('Hello!').isVisible();
```

Convert to:
```gherkin
@e2e @dm-flow
Feature: Direct Message Between Users

  Scenario: User1 creates DM with User2 and sends a message
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat"
    And I click on "[data-testid='create-new-dm']"
    And I type "user:user2-browser.email" on the element "[data-testid='search-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='search-results']"
    And I type "Hello!" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-button']"
    And I store the current path as "user1-user2-dm"

    # Switch to user2 to verify message received
    Given using browser "user2-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    Then I should see "Hello!" in the element "[data-testid='message-list']"
```

Example 2 - Single User Test (only admin involved):
```typescript
// Playwright spec - single page instance
test('create public channel', async ({ page }) => {
  await page.goto('/chat');
  await page.getByTestId('create-channel').click();
  await page.getByTestId('channel-name').fill('Test Channel');
  await page.getByTestId('submit').click();
});
```

Convert to:
```gherkin
@e2e @channel-create
Feature: Channel Creation

  Background:
    Given using browser "admin-browser"

  Scenario: Create a public channel
    When I open the Xyne-Space at "/chat"
    And I click on "[data-testid='create-channel']"
    And I type "user:admin-browser.id" on the element "[data-testid='channel-name']"
    And I click on "[data-testid='submit']"
```

**KEY PRINCIPLES:**
1. **Analyze the spec FIRST** — Count distinct page/browser instances before writing any steps
2. **Single page = single browser** → Use "admin-browser" for everything
3. **Multiple pages/users = multiple browsers** → Map each to admin/user1/user2/user3
4. **Switch context explicitly** with `Given using browser "xxx-browser"` when the action changes between users
5. **Store paths for sharing** — Use `I store the current path as` so other users can navigate to the same resource

**NEVER create new browser windows or contexts.** The e2e setup phase already creates and logs in browsers: "admin-browser", "user1-browser", "user2-browser", "user3-browser". These are fully authenticated and ready to use.
- **ALWAYS reuse existing browsers from setup.** Just switch to them:
  ```gherkin
  Given using browser "admin-browser"
  ```
  Do NOT use `Given a browser "..." with viewport ...` — that creates a NEW browser window and loses the authenticated session.
- **Use `Background:` section** to set the browser context shared across all scenarios:
  ```gherkin
  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
  ```
- **Dynamic user references** — NEVER hardcode user names, emails, or IDs. Use the `user:<browser>.name`, `user:<browser>.email`, or `user:<browser>.id` syntax:
  ```gherkin
  And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
  And I type "user:user1-browser.id" on the element "[data-testid='channel-name-input']"
  And I should see "user:user1-browser.id" in the element "[data-testid='channel-list']"
  ```
  This resolves dynamically at runtime to the actual user name/email/id for that browser session.
- **Stored paths** — Use stored path aliases (e.g., "admin-channel-1", "user1-user2-dm", "group-chat-1") with `I open the Xyne-Space at` for navigation to previously visited pages. These are stored during setup or earlier scenarios using `I store the current path as`.
- **Keep feature files compact** — Use `Scenario Outline` with `Examples` tables when the same flow is repeated for multiple users/data. Split into multiple focused `Scenario` blocks only when the flows are genuinely different.
- Include appropriate @tags at the top of the feature file. Use tags that support both:
  - Running as part of the full e2e flow: `@e2e @feature-name`
  - Running standalone: `@feature-specific-tag` (e.g., `@ticket-create`, `@dm-send`)
- Match existing import style, folder layout, and naming patterns.
- Do not use number prefixes for folders or files — the automation script assigns them.

### Rule 7b — E2E Flow Compatibility
- Generated tests MUST work in TWO modes:
  1. **Full e2e flow** (`@e2e` tag): Runs after setup scenarios that create browsers and log in users. Browsers are already initialized.
  2. **Standalone** (feature-specific tag): Requires only the setup scenarios to have run. Do NOT depend on other feature files' side effects unless explicitly using stored paths.
- NEVER assume a fresh/blank state. The e2e setup creates channels, users, and browser sessions that persist across all scenarios.
- If the Playwright test does `page.goto('/some-path')`, convert it to `When I open the Xyne-Space at "/some-path"` — the step automatically prepends the base URL.

### Rule 13 — Generic & Reusable Test Design (CRITICAL)
The generated Cucumber tests MUST be generic, data-driven, and environment-independent. They should work across any test environment with any set of test users. Follow these principles:

**A) NEVER hardcode user-specific data.** Replace ALL hardcoded values with dynamic references:
| Hardcoded (WRONG) | Dynamic (CORRECT) |
|---|---|
| `"john@example.com"` | `"user:user2-browser.email"` |
| `"John Doe"` | `"user:user2-browser.name"` |
| `"test-channel-123"` | `"user:user1-browser.id"` (for user-specific resource names) |
| `"/chat/ch_abc123"` | Use stored path alias instead |
| `"Naveen-Y"` | `"user:admin-browser.id"` |

**B) Distinguish Between Channel Search and User Search**:
The spec may search for channels OR users. Context matters:

| Pattern | Context | Correct Conversion |
|---|---|---|
| `fill('channel-name')` then click in `[aria-label='Suggestions']` | Channel search | Select first result (channels already exist from e2e) |
| `fill('email@domain')` then click in user results | User search | Use `user:xxx-browser.email` |
| After clicking `tab-channels` | Channel context | Navigate to stored path OR select first result |
| After clicking `create-new-dm` | User context | Search for another user (NOT yourself) |

**CRITICAL — Channel Search Flow (Use Stored Channel Path)**:
Channels are already created in e2e setup. Navigate directly using stored paths instead of searching:

```typescript
// Spec searches for a channel
await page.getByTestId('tab-channels').click();
await page.getByRole('paragraph').click();
await page.getByTestId('search-textbox').fill('test-on-local');
await page.getByLabel('Suggestions').getByText('test-on-local').click();
await page.getByTestId('join-channel-btn').click();
```

**CORRECT conversion** (navigate to stored channel path):
```gherkin
# Option 1: Navigate directly to the stored channel path (PREFERRED)
When I open the Xyne-Space at "user1-channel-1"
And I wait for "[data-testid='chat-list-loading']" to disappear
```

**CORRECT conversion** (if search is required by the spec):
```gherkin
# Option 2: Use command palette and select first result
And I press the "ControlOrMeta+k" key on the element "body"
And I click on "[data-testid='tab-channels']"
And I click on "[aria-label='Suggestions'] button:first-child"    # Select first available channel
```

**WRONG conversion**:
```gherkin
And I type "test" using keyboard                      # WRONG - hardcoded generic name!
And I type "user:user1-browser.id" using keyboard     # WRONG - channels aren't named by user ID!
And I click on text "user:user1-browser.name"         # WRONG - user.name is for users, not channels!
```

**CRITICAL — Search Result Selection (Use TestID-based Selection)**:
Search results can vary each time. When selecting from search results, prefer testid-based selection or first-child:

| Search Context | Suggestion Selector Pattern |
|---|---|
| Channel search results | `[aria-label='Suggestions'] button:first-child` (select first) |
| User search results | `[data-testid='user-search-results'] button:first-child` or by user reference |
| Generic suggestions | Click first available result |

**When selecting from search suggestions**:
```gherkin
# Channel search - select first result (channels already exist from e2e)
And I click on "[aria-label='Suggestions'] button:first-child"

# User search - select by user reference (you're selecting a specific person)
And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
```

**NEVER hardcode search terms** like "test", "test-channel", etc.:
- For channels: Navigate to stored path (`user1-channel-1`) OR select first result
- For users: Use `user:<TARGET-browser>.email` or `user:<TARGET-browser>.name`

**C) Use Existing E2E Resources — NEVER Create New Prerequisites**:

The e2e setup creates resources. Your generated tests MUST use these existing resources:

**Browser Sessions (created by @setup)**:
| Browser | User |
|---|---|
| `admin-browser` | Admin user |
| `user1-browser` | User 1 |
| `user2-browser` | User 2 |
| `user3-browser` | User 3 |

**Existing Resources (already created by e2e flow)**:
| Resource | Stored Path | Created By | Named As | Tag |
|---|---|---|---|---|
| Channel | `user1-channel-1` | user1-browser | `user:user1-browser.id` | `@channel-create` |
| DM | `user1-user2-dm` | user1-browser | — | `@dm-create` |
| Group Chat | `group-chat-1` | user1-browser | — | `@group-chat-create` |

**CRITICAL — Resource Creator vs Resource Finder**:

When searching for a resource, use the STORED PATH or CHANNEL ID from e2e setup:

| Scenario | Current Browser | What to Search For | Why |
|---|---|---|---|
| Admin joins user1's channel | admin-browser | Navigate to `user1-channel-1` | Channel was created by user1 in e2e |
| Admin views user1's DM | admin-browser | Navigate to `user1-user2-dm` | DM was created by user1 in e2e |
| User2 joins user1's channel | user2-browser | Navigate to `user1-channel-1` | Channel was created by user1 in e2e |
| User1 views own channel | user1-browser | Navigate to `user1-channel-1` | Direct navigation to stored path |

**Example — Admin joins user1's channel (direct navigation)**:
```gherkin
# Admin wants to view/join user1's channel - navigate directly using stored path
Given using browser "admin-browser"
When I open the Xyne-Space at "user1-channel-1"
And I wait for "[data-testid='chat-list-loading']" to disappear
```

**Example — Searching for a channel (if needed)**:
```gherkin
# If you need to search via command palette, the search finds channels by their stored ID
Given using browser "admin-browser"
And I press the "ControlOrMeta+k" key on the element "body"
And I click on "[data-testid='tab-channels']"
# Search finds the channel - select first result
And I click on "[aria-label='Suggestions'] button:first-child"
```

**WRONG — Using user ID to search for channels**:
```gherkin
# WRONG - channels are NOT named by user ID!
And I type "user:user1-browser.id" using keyboard    # WRONG - channel isn't named by user ID!

# WRONG - hardcoded channel name
And I type "test" using keyboard                      # WRONG - channel isn't named "test"!

# WRONG - using user.name for channel search
And I type "user:user1-browser.name" using keyboard   # WRONG - channels aren't named by user name!
```

**Rule**: Before using any resource reference, ask yourself:
1. Was this resource created in e2e setup? → Use the stored path (`user1-channel-1`, `user1-user2-dm`, `group-chat-1`)
2. If navigating directly → Use `When I open the Xyne-Space at "<stored-path>"`
3. If searching via command palette → Select the first result (channels are already created)
4. If searching for a user → Use `user:<TARGET-browser>.email` or `user:<TARGET-browser>.name`

**When spec navigates to a chat**:
```gherkin
# CORRECT - use stored path (works for any browser)
When I open the Xyne-Space at "user1-channel-1"
And I wait for "[data-testid='chat-list-loading']" to disappear
```

**When spec navigates to a channel**:
```gherkin
# Navigate directly to stored channel path (PREFERRED)
When I open the Xyne-Space at "user1-channel-1"
And I wait for "[data-testid='chat-list-loading']" to disappear
```

**When spec must search for a channel via command palette**:
```gherkin
# Use command palette and select first available channel
And I press the "ControlOrMeta+k" key on the element "body"
And I click on "[data-testid='tab-channels']"
And I click on "[aria-label='Suggestions'] button:first-child"
```

**Rule**: NEVER create new prerequisite scenarios. Use existing resources from e2e setup.

**D) Scenario Dependencies — Store Paths for Subsequent Scenarios**:
When multiple scenarios in the same feature depend on each other:
1. **First scenario stores the path** after creating/joining a resource
2. **Subsequent scenarios use the stored path** to navigate

```gherkin
Scenario: Join a channel
  And I click on "[data-testid='join-channel-btn']"
  And I wait for "[data-testid='chat-list-loading']" to disappear
  And I store the current path as "joined-channel"  # STORE IT!

Scenario: Edit the channel
  When I open the Xyne-Space at "joined-channel"  # USE IT!
  And I wait for "[data-testid='chat-list-loading']" to disappear
```

**E) Store and reuse dynamically generated paths.** When a Playwright test creates a resource (channel, ticket, DM, etc.) and then navigates to it:
  1. After creation, add: `And I store the current path as "<alias>"`
  2. For subsequent navigation to that resource, use: `When I open the Xyne-Space at "<alias>"`
  
  Example — Playwright spec creates a channel then interacts with it:
  ```
  Spec: page.click('[data-testid="create-channel-button"]')
  Spec: // page is now at /chat/ch_xyz789
  Spec: page.click('[data-testid="channel-info-trigger"]')
  ```
  Convert to:
  ```gherkin
  And I click on "[data-testid='create-channel-button']"
  And I store the current path as "user1-channel-1"
  And I click on "[data-testid='channel-info-trigger']"
  ```
  Later scenarios can navigate back:
  ```gherkin
  When I open the Xyne-Space at "user1-channel-1"
  ```

**C) Global Keyboard Shortcuts — Use `body` Element**:

Global keyboard shortcuts (like `ControlOrMeta+k` for search/command palette) should be pressed on `body`, NOT on specific elements like `message-input`.

| Shortcut | Purpose | Correct Element |
|---|---|---|
| `ControlOrMeta+k` | Open search/command palette | `body` |
| `Escape` | Close modal/dropdown | `body` |
| `Enter` | Submit form | The form element or `body` |

**Example**:
```typescript
// Playwright spec
await page.getByTestId('message-input').press('ControlOrMeta+k');
```

**WRONG conversion** (message-input doesn't exist on channel list page):
```gherkin
And I press the "ControlOrMeta+k" key on the element "[data-testid='message-input']"
```

**CORRECT conversion** (global shortcut uses body):
```gherkin
And I press the "ControlOrMeta+k" key on the element "body"
```

**D) Wait for Page Elements After Navigation**:

After navigating to a page, wait for critical elements before interacting:

```gherkin
When I open the Xyne-Space at "/chat"
And I wait for "[data-testid='chat-list-loading']" to disappear
# Now safe to interact with elements
```

**E) Use Scenario Outline for repetitive multi-user flows.** If the Playwright test repeats the same action for multiple users, convert it into a Scenario Outline with an Examples table using dynamic user references:
  ```gherkin
  Scenario Outline: Add users to channel
    Given using browser "user1-browser"
    And I type "<email>" on the element "[data-testid='user-search-input']"
    And I click on text "<name>" in the element "[data-testid='user-search-results']"
    And I click on "[data-testid='add-people-submit']"
    Examples:
      | email                    | name                    |
      | user:user2-browser.email | user:user2-browser.name |
      | user:user3-browser.email | user:user3-browser.name |
  ```

**D) Use Scenario Outline for multi-browser verification.** If the spec checks that multiple users see the same result:
  ```gherkin
  Scenario Outline: Users can see the channel after being added
    Given using browser "<browser>"
    When I open the Xyne-Space at "/chat"
    Then I should see "user:user1-browser.id" in the element "[data-testid='channel-list']"
    Examples:
      | browser       |
      | user2-browser |
      | user3-browser |
  ```

**E) Name stored paths descriptively using the browser/user context:**
  - `"user1-channel-1"` — channel created by user1
  - `"admin-ticket-1"` — ticket created by admin
  - `"user1-user2-dm"` — DM between user1 and user2
  - `"group-chat-1"` — group chat

**F) Detect implicit resource creation.** If the Playwright spec does a click that results in a page redirect (URL changes after creating a resource), add a `store the current path` step even if the original spec doesn't explicitly store it. This makes the test reusable for subsequent scenarios.

**G) Use Existing E2E Resources — NEVER Create New Prerequisites.**

The e2e setup already creates all necessary resources. Your tests should USE these existing resources, not create new ones:

  Example — Playwright spec searches for a hardcoded channel:
  ```
  Spec: page.fill('[data-testid="search-textbox"]', 'test-on-local')
  Spec: page.click('text=test-on-local')
  ```
  WRONG conversion (hardcoded, will fail):
  ```gherkin
  And I type "test-on-local" on the element "[data-testid='search-textbox']"
  And I click on text "test-on-local"
  ```
  CORRECT conversion (use existing channel from e2e setup):
  ```gherkin
  # Navigate directly to the stored channel path
  When I open the Xyne-Space at "user1-channel-1"
  And I wait for "[data-testid='chat-list-loading']" to disappear
  ```

  The same principle applies to ALL resources:
  - **Searching for a user** → use `user:<browser>.name` or `user:<browser>.email`
  - **Accessing a channel** → navigate to stored path (`user1-channel-1`)
  - **Accessing a DM** → navigate to stored path (`user1-user2-dm`)
  - **Accessing a group chat** → navigate to stored path (`group-chat-1`)
  - **Sending a DM to a user** → use `user:<browser>.name` to find the user, not a hardcoded name

**CRITICAL — When Searching for Users, ALWAYS Select SOMEONE ELSE (Not Yourself):**
- If admin-browser is searching → select `user:user1-browser.name` or `user:user2-browser.name` (NOT `user:admin-browser.name`)
- If user1-browser is searching → select `user:user2-browser.name` or `user:admin-browser.name` (NOT `user:user1-browser.name`)
- If user2-browser is searching → select `user:user1-browser.name` or `user:admin-browser.name` (NOT `user:user2-browser.name`)

**Why?** When you create a DM or add someone to a channel, you are selecting ANOTHER person, not yourself. You never send a DM to yourself or add yourself to a channel.

**Example — admin-browser creates DM with user2:**
- ❌ WRONG: `I type "user:admin-browser.email" on the element "#search"` AND `I click on text "user:admin-browser.name"` (you don't DM yourself)
- ✅ CORRECT: `I type "user:user2-browser.email" on the element "#search"` AND `I click on text "user:user2-browser.name"` (you DM someone else)

**Example — user1-browser wants to join an existing channel:**
- ❌ WRONG: `I type "test" using keyboard` (hardcoded channel name)
- ✅ CORRECT: `When I open the Xyne-Space at "admin-channel-1"` (navigate to stored path)
- ✅ CORRECT: `And I click on "[aria-label='Suggestions'] button:first-child"` (select first available channel)

  **NOTE — Hardcoded text IS allowed** for arbitrary content that does not identify a user or resource:
  - ✅ Message content: `I type "hello" on the element "[data-testid='message-input']"`
  - ✅ Descriptions: `I type "A test project description" on the element "[data-testid='description-input']"`
  - ✅ Assertions on sent messages: `I should see "Hello from user1!" in the element "[data-testid='virtuoso-item-list']"`
  - ✅ Generic search terms: `I type "test" on the element "[data-testid='search-textbox']"`
  - ❌ User names/emails/IDs: MUST use `user:<browser>.*` syntax
  - ❌ Resource names derived from users: MUST use `user:<browser>.id` or similar

**H) Split multi-concern specs into focused scenarios.** If a Playwright spec does create → search → join → edit → leave all in one test, split it into separate scenarios that share state via stored paths:
  ```gherkin
  Scenario: Create channel
    ...create and store path...

  Scenario: Search and join channel
    ...use stored path or dynamic name to find it...

  Scenario: Edit channel description
    ...navigate to stored path, edit...

  Scenario: Leave channel
    ...navigate to stored path, leave...
  ```
  This makes each scenario independently debuggable and rerunnable.

### Rule 8 — Proper Cucumber Feature File Format
- The feature file MUST start with a `Feature:` keyword followed by a descriptive name.
- Each scenario MUST use `Scenario:` or `Scenario Outline:` keyword.
- Steps MUST use `Given`, `When`, `Then`, `And`, or `But` keywords properly.
- The feature file MUST be syntactically valid Gherkin — no free-text paragraphs, no missing keywords, no broken indentation.
- Each step MUST be on its own line with proper 4-space or 2-space indentation under the Scenario.
- Use `Background:` for common setup steps shared across scenarios in the same feature file.
- If the Playwright test has multiple `test()` blocks, create separate `Scenario:` blocks for each.
- Add a blank line between scenarios for readability.
- Tags (e.g., `@smoke`, `@e2e`) go on the line BEFORE the Feature or Scenario they apply to.

### Rule 10 — Handling Existing Scenarios (Incremental Addition)
- If the output folder already contains .feature and .steps.ts files (provided below as "EXISTING CUCUMBER FILES"), you MUST:
  1. READ all existing scenarios carefully.
  2. ONLY generate scenarios for Playwright test() blocks that are NOT already covered by an existing scenario.
  3. Use the NEXT available number prefix for your new files (e.g., if 01_login.feature exists, your new file should be 02_<name>.feature).
  4. DO NOT duplicate, overwrite, or regenerate any existing scenario.
  5. If you define new step definitions, make sure they do NOT conflict with steps already defined in existing steps files in that folder.
  6. If ALL test() blocks from the Playwright file are already covered, output the files anyway with just the uncovered scenarios (even if minimal).
- When multiple feature files exist in a folder, each covers different scenarios — do NOT merge them into one file.

### Rule 11 — Keyboard Commands & Key Presses
- **NEVER skip or ignore keyboard actions** from the Playwright spec — they are often critical for form submissions, dropdown navigation, closing modals, opening command palettes, etc.
- Convert ALL keyboard actions using these generic patterns:

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.keyboard.press('<key>')` | `I press the "<key>" key` |
| `page.keyboard.type('<text>')` | `I type "<text>" using keyboard` |
| `page.locator('<sel>').press('<key>')` | `I press the "<key>" key on the element "<sel>"` |
| `page.keyboard.down('<key>')` | `I hold the "<key>" key` |
| `page.keyboard.up('<key>')` | `I release the "<key>" key` |
| `page.getByTestId('<id>').press('<key>')` | `I press the "<key>" key on the element "[data-testid='<id>']"` |

- The `<key>` value must be copied EXACTLY from the Playwright spec (e.g., "Enter", "Escape", "Tab", "ArrowDown", "Control+a", "ControlOrMeta+k", "Meta+Shift+p", etc.) — do NOT rename or translate key names.
- **CRITICAL — Step definitions are REQUIRED**: For EVERY keyboard/action step you use in the .feature file, you MUST check the QUICK REFERENCE list. If the step pattern is NOT already defined, you MUST add the step definition in your .steps.ts file using the EXACT same Playwright API from the spec. Examples:
  - Spec: `await page.keyboard.press("ControlOrMeta+k");`
    Feature: `And I press the "ControlOrMeta+k" key`
    Steps file must define: `When('I press the {string} key', ...)` calling `this.page.keyboard.press(key)`
  - Spec: `await page.getByTestId('message-input').press('ControlOrMeta+k');`
    Feature: `And I press the "ControlOrMeta+k" key on the element "[data-testid='message-input']"`
    Steps file must define: `When('I press the {string} key on the element {string}', ...)` calling `this.page.locator(selector).press(key)`
  - Spec: `await page.locator('#search').press('Enter');`
    Feature: `And I press the "Enter" key on the element "#search"`
    Steps file must define the same locator.press pattern
- Playwright-specific key abstractions like "ControlOrMeta" MUST be passed through exactly as-is — they are resolved by Playwright at runtime (Control on Linux/Windows, Meta on macOS). Do NOT translate them to "Control" or "Meta".
- This rule applies equally to ALL Playwright actions that don't have a matching step in QUICK REFERENCE — not just keyboard. If the spec uses ANY Playwright API (drag, hover, focus, selectOption, check, uncheck, dblclick, etc.) that maps to a step not in QUICK REFERENCE, you MUST define that step in your .steps.ts file with the correct Playwright implementation.

### Rule 12 — Wait Steps & Timing
- Playwright specs often have explicit waits: `page.waitForURL(...)`, `page.waitForSelector(...)`, `page.waitForTimeout(...)`, `locator.waitFor()`, `expect(locator).toBeVisible()`, etc.
- **NEVER skip wait calls** — they exist because the UI needs time to load/navigate. Skipping them causes the NEXT step to timeout.
- Convert waits using these patterns:

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.waitForSelector('sel')` or `locator.waitFor()` | `I wait for "sel" to be visible` |
| `page.waitForSelector('sel', { state: 'hidden' })` | `I wait for "sel" to disappear` |
| `expect(locator).toBeVisible()` | `I wait for "sel" to be visible` |
| `page.waitForURL('**/path')` | `I wait for the URL to contain "/path"` |
| `page.waitForTimeout(N)` | `I wait for N milliseconds` |
| `page.waitForLoadState('networkidle')` | `I wait for the page to finish loading` |

- **CRITICAL — Implicit waits**: When a Playwright spec navigates (e.g., clicks a button that loads a new page) and then immediately interacts with an element on the new page, you MUST add a wait step between the navigation and the interaction. Look for patterns like:
  - Click → waitForURL → interact with new page element
  - Click → waitForSelector → interact with element
  - goto → waitForLoadState → interact
  If the spec has these wait calls, convert them. If the spec DOESN'T have explicit waits but does navigate-then-interact, add `I wait for "selector" to be visible` before the interaction step.
- **Element readiness for keyboard actions**: Before pressing keys on an element (`.press()`, `.type()`), the element must be visible AND focused. If the spec has `element.click()` followed by `element.press('key')`, keep BOTH steps — the click focuses the element.
- Check the QUICK REFERENCE list for available wait and keyboard step patterns before creating new ones. If a matching step already exists in shared files, do NOT redefine it.

### Rule 9 — User Search & Selection Patterns (CRITICAL for DMs, Channel Member Addition, etc.)
**When converting Playwright tests that involve searching for and selecting users (DM creation, adding members to channels, etc.), you MUST use the search-first-then-select-first-result pattern.**

**Problem to avoid**: The LLM incorrectly converts `page.getByText('UserName').click()` to clicking on the current user's name, when the actual intent is to select a searched-for user from search results.

**CRITICAL — Incomplete Spec Detection**: Many Playwright specs are incomplete and skip the search step. You MUST detect these incomplete patterns and INJECT the missing search step:

| Incomplete Spec Pattern (NO search) | Complete Conversion (WITH search) |
|---|---|
| `getByTestId('create-new-dm').click()` then `getByText('UserName').click()` | ADD search step! See example below |
| `getByTestId('add-member').click()` then `getByText('UserName').click()` | ADD search step! See example below |

**Example — Incomplete Spec (Missing Search)**:
```typescript
// Playwright spec is INCOMPLETE - no search step!
await page.getByTestId('create-new-dm').click();
await page.getByText('Naveen Yallattikar').click();  // Directly clicks user without searching!
await page.getByTestId('message-input').fill('hello');
```

**CORRECT conversion (inject missing search step)**:
```gherkin
Given using browser "admin-browser"
When I click on "[data-testid='create-new-dm']"
And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"    # INJECTED!
And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
And I type "hello" on the element "[data-testid='message-input']"
```

**WRONG conversion (faithful to incomplete spec, will FAIL)**:
```gherkin
# WRONG - no search step, user not visible on page!
When I click on "[data-testid='create-new-dm']"
And I click on text "user:user2-browser.name"    # FAILS - user not visible yet!
```

**Correct conversion pattern for user search flows**:
1. **First**: Type the search term (email or name) into the search input
2. **Then**: Click on the first available result in the search results container
3. **ALWAYS use the correct user reference** (user2-browser when user1 is searching, user1-browser when user2 is searching, etc.)

**Key rules for user search flows**:
1. **Identify the browser/user context**: Who is performing the action? (admin-browser, user1-browser, user2-browser, etc.)
2. **Determine who they are searching for**: Look at the spec's test data, test name, or comments to identify the target user
3. **Use the correct user reference**: If user1 is creating a DM, they search for user2 → use `user:user2-browser.email` and `user:user2-browser.name`
4. **Always use search-first-then-select-first-result pattern**:
   - Type search term → `And I type "user:target-browser.email" on the element "[data-testid='user-search-input']"`
   - Select first result → `And I click on text "user:target-browser.name" in the element "[data-testid='user-search-results']"`
5. **INJECT missing search steps**: If the spec jumps from a "create" action to clicking a user name, ADD the search step

**Common user search patterns to recognize**:
- DM creation: `create-new-dm` → search input → click on user name
- Add member to channel: search input → click on user → add button
- Search users in sidebar: search input → click on result
- Mention autocomplete: type @ → search → click on user

**Selector patterns for user search**:
- Search input: `[data-testid='user-search-input']`, `[data-testid='search-input']`, `input[type='search']`
- Search results container: `[data-testid='user-search-results']`, `[data-testid='search-results']`, `.user-list`, `.results-container`

**If the spec uses a hardcoded name/email in `getByText()` or `fill()`**:
- Replace with the correct dynamic user reference based on context
- Example: `page.getByText('John Doe').click()` → `And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"`
- Example: `page.fill('#search', 'jane@example.com')` → `And I type "user:user3-browser.email" on the element "#search"`

**Rule of thumb**: Whenever you see a pattern like:
1. Click something that opens a search (DM button, add member button, etc.)
2. Fill a search input with a user identifier
3. Click on a user name/email
4. Continue with the action (send message, add to channel, etc.)

Convert it to the search-first-then-select-first-result pattern with the correct dynamic user reference.

### Rule 9b — Electron/Desktop Elements
- For Electron desktop app elements (native menus, title bars, system dialogs, tray icons, notifications):
  - Use Playwright Electron APIs (e.g., `electronApp.evaluate()`)
  - Use role-based selectors (e.g., `role=button[name="Close"]`)
  - Use accessibility labels or native element queries
- NEVER apply `data-testid` to elements that are part of the Electron shell, OS-level dialogs, or native menus.

## Step Definition Template:
```typescript
When('exact step phrase from feature file', async function (this: CustomWorld, param1: string) {
  if (!this.page) throw new Error('Browser not initialized');
  // Implementation here
  uiLogger.info(`[Context] Executed step: ${param1}`);
});
```

## OUTPUT FORMAT (MUST FOLLOW EXACTLY):

You MUST output BOTH files with complete content inside fenced code blocks.

**CRITICAL — EVERY feature file MUST start with a browser context step.** The VERY FIRST step in the Background (or the first Scenario if no Background) MUST be:
```gherkin
Given using browser "admin-browser"
```
WITHOUT this, the test has NO browser and will fail immediately. If multiple users are needed, switch browsers mid-scenario with additional `Given using browser "userN-browser"` steps.

**ABSOLUTELY FORBIDDEN**: Do NOT use `Given a browser "..." with viewport ...` — this creates a NEW unauthenticated browser and the test WILL FAIL. The browsers are already created and logged in by the e2e setup. You MUST use `Given using browser "admin-browser"` to switch to the existing authenticated browser.

Example feature file structure (FOLLOW THIS EXACTLY):
```gherkin
@e2e @feature-name
Feature: My Feature

  Background:
    Given using browser "admin-browser"

  Scenario: Do something
    When I open the Xyne-Space at "/some-path"
    And I click on "[data-testid='some-button']"
```

## File: tests/03_e2e/FOLDER_NAME/NN_<file_name>.feature
```gherkin
<full feature file content>
```

## File: tests/03_e2e/FOLDER_NAME/steps/NN_<file_name>.steps.ts
```typescript
<full steps file content>
```

**CRITICAL — Output Folder**:
PROMPT_EOF

    # Inject the actual output folder path into the prompt
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## TARGET OUTPUT FOLDER (USE THIS EXACT PATH — DO NOT CHANGE):" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "Output folder: tests/03_e2e/${OUTPUT_FOLDER}" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "Your files MUST be:" >> "$TEMP_PROMPT_FILE"
    echo "  - Feature: tests/03_e2e/${OUTPUT_FOLDER}/NN_<name>.feature" >> "$TEMP_PROMPT_FILE"
    echo "  - Steps:   tests/03_e2e/${OUTPUT_FOLDER}/steps/NN_<name>.steps.ts" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "Do NOT use any other folder path. The folder '${OUTPUT_FOLDER}' already exists and is the correct location for this test." >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    
    # Add user action context if exists
    if [ -n "${USER_ACTION:-}" ]; then
        echo "## USER DECISION:" >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        if [ "$USER_ACTION" = "update" ]; then
            echo "The user wants to UPDATE existing files — only generate scenarios that are NOT already covered." >> "$TEMP_PROMPT_FILE"
            echo "Existing scenarios are provided below. Do NOT recreate them. Only add new scenarios." >> "$TEMP_PROMPT_FILE"
        elif [ "$USER_ACTION" = "regenerate_all" ]; then
            echo "The user wants to REGENERATE ALL scenarios — create completely new files with all test cases." >> "$TEMP_PROMPT_FILE"
            echo "Existing files will be preserved (not modified), and your output will use new file names." >> "$TEMP_PROMPT_FILE"
        fi
        echo "" >> "$TEMP_PROMPT_FILE"
    fi

    # If a dry-run report is provided, append it to the prompt for correction
    if [ -n "$DRY_RUN_REPORT_FILE" ] && [ -f "$DRY_RUN_REPORT_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "## PREVIOUS ATTEMPT FAILED - DRY RUN VALIDATION ERRORS:" >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "The previous conversion attempt failed validation. Here is the dry-run report showing the errors:" >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
        cat "$DRY_RUN_REPORT_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "**CRITICAL**: You MUST fix these errors in your output:" >> "$TEMP_PROMPT_FILE"
        echo "1. If there are 'Multiple step definitions match' errors, REMOVE the duplicate step definitions from your .steps.ts file. Use ONLY the steps from shared files." >> "$TEMP_PROMPT_FILE"
        echo "2. If there are 'Undefined' step errors, ADD the missing step definitions to your .steps.ts file." >> "$TEMP_PROMPT_FILE"
        echo "3. If there are TypeScript compilation errors, fix the type errors in your .steps.ts file." >> "$TEMP_PROMPT_FILE"
        echo "4. Carefully review the shared step files provided earlier and DO NOT recreate any steps that already exist." >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
    fi

    # Append the actual Playwright content to the prompt file
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## Playwright Test Content:" >> "$TEMP_PROMPT_FILE"
    echo '```typescript' >> "$TEMP_PROMPT_FILE"
    cat "$ABSOLUTE_PATH" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"

    # Append existing feature/steps content so LLM knows what scenarios already exist
    if [ ${#EXISTING_FEATURE_FILES[@]} -gt 0 ] || [ ${#EXISTING_STEPS_FILES[@]} -gt 0 ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "## EXISTING CUCUMBER FILES IN THIS FOLDER (DO NOT duplicate these scenarios):" >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "The following feature and step files already exist in the output folder '${OUTPUT_FOLDER}'." >> "$TEMP_PROMPT_FILE"
        echo "**CRITICAL**: Do NOT recreate or duplicate any scenario that already exists below." >> "$TEMP_PROMPT_FILE"
        echo "Only generate NEW scenarios for test cases in the Playwright file that are NOT already covered." >> "$TEMP_PROMPT_FILE"
        echo "If ALL scenarios from the Playwright file already exist, you MUST still output the files with the existing content (do not skip output)." >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"

        for ef in "${EXISTING_FEATURE_FILES[@]}"; do
            ef_basename=$(basename "$ef")
            echo "### Existing feature: ${ef_basename}" >> "$TEMP_PROMPT_FILE"
            echo '```gherkin' >> "$TEMP_PROMPT_FILE"
            cat "$ef" >> "$TEMP_PROMPT_FILE"
            echo '```' >> "$TEMP_PROMPT_FILE"
            echo "" >> "$TEMP_PROMPT_FILE"
        done

        for es in "${EXISTING_STEPS_FILES[@]}"; do
            es_basename=$(basename "$es")
            echo "### Existing steps: ${es_basename}" >> "$TEMP_PROMPT_FILE"
            echo '```typescript' >> "$TEMP_PROMPT_FILE"
            cat "$es" >> "$TEMP_PROMPT_FILE"
            echo '```' >> "$TEMP_PROMPT_FILE"
            echo "" >> "$TEMP_PROMPT_FILE"
        done

        echo "### Existing file names for reference:" >> "$TEMP_PROMPT_FILE"
        echo "Feature files: ${EXISTING_FEATURE_NAMES[*]}" >> "$TEMP_PROMPT_FILE"
        echo "Steps files: ${EXISTING_STEPS_NAMES[*]}" >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "Use the NEXT available number prefix for any new files. For example, if 01_foo.feature and 02_bar.feature exist, the next file should be 03_<name>.feature." >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
    fi

    # Append cross-folder scenario names if any exist to avoid duplicating scenarios across folders
    if [ -n "$ALL_E2E_SCENARIOS" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "## Scenarios in OTHER e2e test folders (for awareness — avoid naming conflicts):" >> "$TEMP_PROMPT_FILE"
        echo "These scenario names exist in other test folders. Do NOT create scenarios with the same names." >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
        echo -e "$ALL_E2E_SCENARIOS" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
    fi

    # Append existing shared step definitions so Claude knows what's already implemented
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## Existing Shared Step Definitions (DO NOT recreate these):" >> "$TEMP_PROMPT_FILE"

    COMMON_STEPS_FILE="$AUTOMATION_DIR/tests/shared/common.steps.ts"
    BROWSER_STEPS_FILE="$AUTOMATION_DIR/tests/shared/browser.steps.ts"
    E2E_COMMON_STEPS_FILE="$AUTOMATION_DIR/tests/03_e2e/e2e-common.steps.ts"

    # Also include step patterns from existing folder-level steps files to avoid conflicts
    FOLDER_STEPS_PATTERNS=""
    if [ ${#EXISTING_STEPS_FILES[@]} -gt 0 ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### Step definitions already defined in this folder's steps files (DO NOT redefine these):" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
        for es in "${EXISTING_STEPS_FILES[@]}"; do
            es_basename=$(basename "$es")
            echo "# From ${es_basename}:" >> "$TEMP_PROMPT_FILE"
            grep -oE "(Given|When|Then)\('([^']+)'" "$es" 2>/dev/null >> "$TEMP_PROMPT_FILE" || true
            grep -A1 -E "^(Given|When|Then)\($" "$es" 2>/dev/null | grep -oE "'[^']+'" | while read -r pattern; do
                keyword=$(grep -B1 -E "^  *${pattern}" "$es" 2>/dev/null | grep -oE "^(Given|When|Then)" | head -1)
                keyword=${keyword:-When}
                echo "${keyword}(${pattern})" >> "$TEMP_PROMPT_FILE"
            done
            echo "" >> "$TEMP_PROMPT_FILE"
        done
        echo '```' >> "$TEMP_PROMPT_FILE"
        echo "**CRITICAL**: Do NOT redefine any of the above step patterns in your new .steps.ts file." >> "$TEMP_PROMPT_FILE"
        echo "" >> "$TEMP_PROMPT_FILE"
    fi

    # Extract and list exact step patterns for quick reference
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "### QUICK REFERENCE — Exact step patterns available (use these EXACTLY as written):" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "**PRIORITY ORDER**: When writing .feature steps, ALWAYS check these lists FIRST. If a matching step exists here, USE IT. Only create a new step definition if NO existing pattern matches." >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"

    # FIRST: Scan ALL .steps.ts files across the entire e2e directory — these take priority
    echo "# ============================================" >> "$TEMP_PROMPT_FILE"
    echo "# Step definitions from ALL e2e test folders" >> "$TEMP_PROMPT_FILE"
    echo "# DO NOT redefine any of these in your output" >> "$TEMP_PROMPT_FILE"
    echo "# ============================================" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    while IFS= read -r e2e_steps_file; do
        [ -e "$e2e_steps_file" ] || continue
        # Skip the shared files and e2e-common already listed below
        e2e_steps_basename=$(basename "$e2e_steps_file")
        [ "$e2e_steps_basename" = "e2e-common.steps.ts" ] && continue
        # Skip files in the current output folder — already listed in folder-level steps section
        e2e_steps_rel=$(python3 -c "import os; print(os.path.relpath('$e2e_steps_file', '$AUTOMATION_DIR/tests/03_e2e'))" 2>/dev/null || echo "$e2e_steps_file")
        if [ -n "$OUTPUT_FOLDER" ] && [[ "$e2e_steps_rel" == "$OUTPUT_FOLDER"* ]]; then
            continue
        fi
        # Skip _previous backup folders
        [[ "$e2e_steps_file" == *"/_previous/"* ]] && continue
        step_patterns=$(grep -oE "(Given|When|Then)\('([^']+)'" "$e2e_steps_file" 2>/dev/null || true)
        if [ -n "$step_patterns" ]; then
            echo "# From $e2e_steps_rel:" >> "$TEMP_PROMPT_FILE"
            echo "$step_patterns" >> "$TEMP_PROMPT_FILE"
            echo "" >> "$TEMP_PROMPT_FILE"
        fi
    done < <(find "$AUTOMATION_DIR/tests/03_e2e" -name "*.steps.ts" -not -path "*/_previous/*" -not -path "*/node_modules/*" -type f 2>/dev/null)

    # SECOND: Shared step files
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "# ============================================" >> "$TEMP_PROMPT_FILE"
    echo "# Shared step definitions (common, browser, e2e-common)" >> "$TEMP_PROMPT_FILE"
    echo "# ============================================" >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    for STEPS_REF_FILE in "$COMMON_STEPS_FILE" "$BROWSER_STEPS_FILE" "$E2E_COMMON_STEPS_FILE"; do
        if [ -f "$STEPS_REF_FILE" ]; then
            REF_BASENAME=$(basename "$STEPS_REF_FILE")
            echo "# From $REF_BASENAME:" >> "$TEMP_PROMPT_FILE"
            grep -oE "(Given|When|Then)\('([^']+)'" "$STEPS_REF_FILE" 2>/dev/null >> "$TEMP_PROMPT_FILE" || true
            grep -A1 -E "^(Given|When|Then)\($" "$STEPS_REF_FILE" 2>/dev/null | grep -oE "'[^']+'" | while read -r pattern; do
                keyword=$(grep -B1 -E "^  *${pattern}" "$STEPS_REF_FILE" 2>/dev/null | grep -oE "^(Given|When|Then)" | head -1)
                keyword=${keyword:-When}
                echo "${keyword}(${pattern})" >> "$TEMP_PROMPT_FILE"
            done
            echo "" >> "$TEMP_PROMPT_FILE"
        fi
    done

    echo '```' >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "**CRITICAL**: The step phrases above are the EXACT strings extracted from ALL step files across the project. Use them character-for-character in your .feature file." >> "$TEMP_PROMPT_FILE"
    echo "- ALWAYS prefer an existing step pattern over creating a new one. Search the QUICK REFERENCE list above FIRST." >> "$TEMP_PROMPT_FILE"
    echo "- Do NOT rephrase, reorder words, or add/remove words (e.g., do NOT add 'on' or remove 'the element')." >> "$TEMP_PROMPT_FILE"
    echo "- String parameters like browser names MUST be in double quotes in the .feature file (e.g., Given a browser \"user1\" with viewport 1920x1080)." >> "$TEMP_PROMPT_FILE"
    echo "- For navigation, use: When I open the Xyne-Space at \"/path\" (NOT 'I navigate to')." >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"

    # Add explicit instruction about URL handling
    NAVIGATION_RULE="IMPORTANT: For page.goto() calls, use the step 'I open the Xyne-Space at \"/path\"' with ONLY the relative path (e.g., \"/auth\", \"/dashboard\"). Do NOT use 'I navigate to' — that step does NOT exist. Do NOT include base URL, config variables like {config.dashboard.baseUrl}, or localhost references. Just the path.
Example: When I open the Xyne-Space at \"/auth\"

CRITICAL — BROWSER REUSE: NEVER use 'Given a browser ... with viewport ...' — this creates a NEW browser window and loses auth context. ALWAYS use 'Given using browser \"admin-browser\"' (or user1-browser, user2-browser, user3-browser) to reuse the already-authenticated browsers from setup.

CRITICAL — USER REFERENCES: NEVER hardcode user names, emails, or IDs. Use dynamic syntax:
  user:admin-browser.name, user:admin-browser.email, user:admin-browser.id
  user:user1-browser.name, user:user1-browser.email, user:user1-browser.id
  user:user2-browser.name, user:user2-browser.email, user:user2-browser.id
  user:user3-browser.name, user:user3-browser.email, user:user3-browser.id"

    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## Navigation URL Handling:" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"
    echo "$NAVIGATION_RULE" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"

    # Add browser reuse and user reference examples
    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## CRITICAL — Browser Reuse & User Reference Examples:" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"
    cat >> "$TEMP_PROMPT_FILE" << 'BROWSER_REUSE_EOF'
The e2e setup already creates these authenticated browsers:
  - "admin-browser" (admin user — DEFAULT, use this unless another user is explicitly needed)
  - "user1-browser"
  - "user2-browser"
  - "user3-browser"

ALWAYS use "Given using browser <name>" to switch to an existing browser. NEVER create new browsers.

✅ CORRECT — Reuse existing browser:
  Given using browser "admin-browser"
  When I open the Xyne-Space at "admin-channel-1"

❌ WRONG — Creates a new browser window (loses auth session):
  Given a browser "my-browser" with viewport 1920x1080

For user references, use dynamic syntax (NEVER hardcode names/emails/IDs):
  ✅ And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  ✅ And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
  ✅ And I type "user:user1-browser.id" on the element "[data-testid='channel-name-input']"
  ✅ And I should see "user:user1-browser.id" in the element "[data-testid='channel-list']"
  ❌ And I type "john@example.com" on the element "[data-testid='user-search-input']"
  ❌ And I click on text "John Doe" in the element "[data-testid='user-search-results']"
  ❌ And I type "test-channel-123" on the element "[data-testid='channel-name-input']"

For Scenario Outlines with multiple users, use dynamic user references in Examples tables:
  Scenario Outline: Add users to channel
    Given using browser "user1-browser"
    And I type "<email>" on the element "[data-testid='user-search-input']"
    And I click on text "<name>" in the element "[data-testid='user-search-results']"
    Examples:
      | email                    | name                    |
      | user:user2-browser.email | user:user2-browser.name |
      | user:user3-browser.email | user:user3-browser.name |

For stored paths (from setup or earlier scenarios):
  ✅ When I open the Xyne-Space at "admin-channel-1"
  ✅ When I open the Xyne-Space at "user1-user2-dm"
  ✅ And I store the current path as "my-ticket-page"

Background section pattern for browser context (use in ALL feature files):
  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

Keyboard actions (NEVER skip these — convert ALL keyboard commands from the spec):
  page.keyboard.press('<key>')         → And I press the "<key>" key
  page.keyboard.type('<text>')         → And I type "<text>" using keyboard
  page.locator('sel').press('<key>')   → And I press the "<key>" key on the element "sel"
  page.keyboard.down('<key>')          → And I hold the "<key>" key
  page.keyboard.up('<key>')            → And I release the "<key>" key
  Copy the exact key name from the spec (Enter, Escape, Tab, Control+a, etc.)
BROWSER_REUSE_EOF
    echo '```' >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"

    echo "" >> "$TEMP_PROMPT_FILE"

    echo "### Full source files (for implementation reference):" >> "$TEMP_PROMPT_FILE"

    if [ -f "$COMMON_STEPS_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### tests/shared/common.steps.ts:" >> "$TEMP_PROMPT_FILE"
        echo '```typescript' >> "$TEMP_PROMPT_FILE"
        cat "$COMMON_STEPS_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
    fi

    if [ -f "$BROWSER_STEPS_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### tests/shared/browser.steps.ts:" >> "$TEMP_PROMPT_FILE"
        echo '```typescript' >> "$TEMP_PROMPT_FILE"
        cat "$BROWSER_STEPS_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
    fi

    if [ -f "$E2E_COMMON_STEPS_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### tests/03_e2e/e2e-common.steps.ts:" >> "$TEMP_PROMPT_FILE"
        echo '```typescript' >> "$TEMP_PROMPT_FILE"
        cat "$E2E_COMMON_STEPS_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
    fi

    # Append type definitions so the LLM knows the exact types available
    WORLD_FILE="$AUTOMATION_DIR/tests/fixtures/cucumber.world.ts"
    CONFIG_FILE="$AUTOMATION_DIR/tests/fixtures/config.ts"

    if [ -f "$WORLD_FILE" ] || [ -f "$CONFIG_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "## Type Definitions (use ONLY these properties and methods):" >> "$TEMP_PROMPT_FILE"
    fi

    if [ -f "$WORLD_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### CustomWorld type (tests/fixtures/cucumber.world.ts):" >> "$TEMP_PROMPT_FILE"
        echo '```typescript' >> "$TEMP_PROMPT_FILE"
        cat "$WORLD_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
    fi

    if [ -f "$CONFIG_FILE" ]; then
        echo "" >> "$TEMP_PROMPT_FILE"
        echo "### Config type (tests/fixtures/config.ts):" >> "$TEMP_PROMPT_FILE"
        echo '```typescript' >> "$TEMP_PROMPT_FILE"
        cat "$CONFIG_FILE" >> "$TEMP_PROMPT_FILE"
        echo '```' >> "$TEMP_PROMPT_FILE"
    fi

    echo -e "${CYAN}Sending to Claude Code...${NC}"
    echo ""

    # Save the prompt for debugging
    PROMPT_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/prompts"
    mkdir -p "$PROMPT_DEBUG_DIR"
    PROMPT_DEBUG_FILE="$PROMPT_DEBUG_DIR/${BASE_NAME}_prompt_$(date +%Y%m%d_%H%M%S).txt"
    cp "$TEMP_PROMPT_FILE" "$PROMPT_DEBUG_FILE"
    echo -e "${CYAN}Prompt saved to: $PROMPT_DEBUG_FILE${NC}"

    # Prepare LLM output file path
    LLM_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LLM_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/llm_output_debug"
    mkdir -p "$LLM_DEBUG_DIR"
    LLM_OUTPUT_FILE="$LLM_DEBUG_DIR/${BASE_NAME}_${LLM_TIMESTAMP}.txt"

    # Log LLM start time to the output file
    LLM_START_EPOCH=$(date +%s)
    LLM_START_TIME_FMT=$(date '+%Y-%m-%d %H:%M:%S')
    echo "--- LLM START TIME: ${LLM_START_TIME_FMT} ---" > "$LLM_OUTPUT_FILE"
    echo "--- INPUT FILE: ${INPUT_FILE} ---" >> "$LLM_OUTPUT_FILE"
    echo "--- MODEL: ${MODEL} ---" >> "$LLM_OUTPUT_FILE"
    echo "" >> "$LLM_OUTPUT_FILE"
    echo -e "${CYAN}LLM started at: ${LLM_START_TIME_FMT}${NC}"

    # Disable focus reporting before starting Claude
    printf '\e[?1004l'

    # Run claude and stream output live while capturing to file
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━ LLM Output (live) ━━━━━━━━━━━━━━━━━━${NC}"

    # Start elapsed timer in background (updates every second)
    {
        elapsed=0
        while true; do
            sleep 1
            elapsed=$((elapsed + 1))
            mins=$((elapsed / 60))
            secs=$((elapsed % 60))
            if [ $mins -gt 0 ]; then
                printf "\r  \033[1;33m⏱ Elapsed: %dm %02ds \033[0m" "$mins" "$secs" >&2
            else
                printf "\r  \033[1;33m⏱ Elapsed: %ds \033[0m" "$secs" >&2
            fi
        done
    } &
    TIMER_PID=$!
    
    # Ensure timer is killed on script exit or interrupt
    trap "kill -9 $TIMER_PID 2>/dev/null || true; printf '\r\033[K' >&2" EXIT INT TERM

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
        API_TIMEOUT_MS=600000 \
        BASH_MAX_TIMEOUT_MS=300000 \
               CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 \
        claude "$(< "$TEMP_PROMPT_FILE")" 2>&1 | while IFS= read -r llm_line; do
            echo "$llm_line" >> "$LLM_OUTPUT_FILE"
            # Print key lines (feature steps, file markers) to stdout for live visibility
            case "$llm_line" in
                *"## File:"*|*"Feature:"*|*"Scenario:"*|"    Given "*|"    When "*|"    Then "*|"    And "*|*'```'*)
                    echo -e "  ${CYAN}${llm_line}${NC}"
                    ;;
            esac
        done
    LLM_EXIT_CODE=${PIPESTATUS[0]}
    set -e

    # Kill the background timer and clear the line - ALWAYS execute this
    if [ -n "${TIMER_PID:-}" ]; then
        kill -9 $TIMER_PID 2>/dev/null || true
        wait $TIMER_PID 2>/dev/null || true
        printf "\r\033[K" >&2  # Clear the timer line
        trap - EXIT INT TERM  # Clear the trap
    fi

    # Calculate and log elapsed time
    LLM_END_EPOCH=$(date +%s)
    LLM_END_TIME_FMT=$(date '+%Y-%m-%d %H:%M:%S')
    LLM_ELAPSED=$((LLM_END_EPOCH - LLM_START_EPOCH))
    LLM_ELAPSED_MINS=$((LLM_ELAPSED / 60))
    LLM_ELAPSED_SECS=$((LLM_ELAPSED % 60))

    # Log elapsed time to the debug output file
    echo "" >> "$LLM_OUTPUT_FILE"
    echo "--- LLM END TIME: ${LLM_END_TIME_FMT} ---" >> "$LLM_OUTPUT_FILE"
    echo "--- LLM ELAPSED: ${LLM_ELAPSED_MINS}m ${LLM_ELAPSED_SECS}s (${LLM_ELAPSED}s total) ---" >> "$LLM_OUTPUT_FILE"
    echo "--- LLM EXIT CODE: ${LLM_EXIT_CODE} ---" >> "$LLM_OUTPUT_FILE"

    echo ""
    if [ $LLM_ELAPSED_MINS -gt 0 ]; then
        echo -e "  ${GREEN}⏱ LLM completed in ${LLM_ELAPSED_MINS}m ${LLM_ELAPSED_SECS}s${NC}"
    else
        echo -e "  ${GREEN}⏱ LLM completed in ${LLM_ELAPSED_SECS}s${NC}"
    fi

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━ End LLM Output ━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Read LLM output from saved file for parsing
    LLM_OUTPUT=$(cat "$LLM_OUTPUT_FILE" 2>/dev/null || echo "")
    echo -e "${CYAN}LLM debug output saved to: $LLM_OUTPUT_FILE${NC}"

    # Check if LLM call failed
    if [ $LLM_EXIT_CODE -ne 0 ]; then
        echo -e "${RED}✗ LLM call failed with exit code: $LLM_EXIT_CODE${NC}"
        echo -e "${YELLOW}  Check the LLM debug output for details:${NC}"
        echo -e "${YELLOW}    $LLM_OUTPUT_FILE${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        rm -f "$TEMP_PROMPT_FILE"
        echo ""
        continue
    fi

    # Check if LLM returned empty output
    if [ -z "$LLM_OUTPUT" ]; then
        echo -e "${RED}✗ LLM returned empty response${NC}"
        echo -e "${YELLOW}  Check the LLM debug output for details:${NC}"
        echo -e "${YELLOW}    $LLM_OUTPUT_FILE${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        rm -f "$TEMP_PROMPT_FILE"
        echo ""
        continue
    fi

    # Extract and save code blocks to files based on code block type
    # The LLM outputs ```gherkin for .feature files and ```typescript for .steps.ts files
    current_file=""
    current_block_type=""
    inside_code=0
    code_content=""
    new_folders=()
    feature_count=0
    steps_count=0
    actual_feature_path=""
    actual_steps_path=""
    # Track all generated files for logging
    all_generated_features=()
    all_generated_steps=()

    echo "[DEBUG] Starting to parse LLM output file: $LLM_OUTPUT_FILE ($(wc -l < "$LLM_OUTPUT_FILE" 2>/dev/null || echo 0) lines)"
    echo "[DEBUG] First 5 lines of LLM output file:"
    head -5 "$LLM_OUTPUT_FILE" 2>/dev/null | while IFS= read -r dbgline; do echo "[DEBUG]   |$dbgline|"; done
    while IFS= read -r line; do
        # Detect file path - handles both "## .*File: "; and markdown bold "**path**" format
        if echo "$line" | grep -q '^## .*File: '; then
            echo "[DEBUG] Raw file path line: $line"
            cleaned_path=$(echo "$line" | sed -E "s/^## .*File: [\`'\"]*//;s/[\`'\"]*$//;s#^/##;s/^ *//")
            echo "[DEBUG] Cleaned file path: $cleaned_path"
            current_file="$cleaned_path"
            code_content=""
            inside_code=0
            continue
        elif echo "$line" | grep -qE '^\*\*.+/.+\*\*$'; then
            # Only match markdown bold lines that contain a path separator (/)
            echo "[DEBUG] Raw file path line (markdown bold): $line"
            cleaned_path=$(echo "$line" | sed -E 's/^\*\*(.*)\*\*$/\1/')
            cleaned_path=$(echo "$cleaned_path" | sed -E 's#^/+##')
            echo "[DEBUG] Cleaned file path: $cleaned_path"
            current_file="$cleaned_path"
            code_content=""
            inside_code=0
            continue
        fi

        # Detect start of code block with language identifier
        # Strip any leading/trailing whitespace from the line for matching
        trimmed_line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [[ "$trimmed_line" =~ ^\`\`\`[[:space:]]*(gherkin|feature)[[:space:]]*$ ]]; then
            inside_code=1
            current_block_type="feature"
            code_content=""
            echo "[DEBUG] Code block started: type=feature (line: $trimmed_line)"
            continue
        elif [[ "$trimmed_line" =~ ^\`\`\`[[:space:]]*(typescript|ts)[[:space:]]*$ ]]; then
            inside_code=1
            current_block_type="steps"
            code_content=""
            echo "[DEBUG] Code block started: type=steps (line: $trimmed_line)"
            continue
        elif [[ "$trimmed_line" =~ ^\`\`\`$ ]] && [ $inside_code -eq 1 ]; then
            # End of code block
            inside_code=0
            
            echo "[DEBUG] Code block ended: type=$current_block_type, content_length=${#code_content}"
            if [ -n "$code_content" ]; then
                # Determine output path based on block type and input file
                # ALWAYS use BASE_NAME for folder and file naming to match script expectations
                if [ "$current_block_type" = "feature" ]; then
                    feature_count=$((feature_count + 1))
                    feature_dir="$AUTOMATION_DIR/tests/03_e2e/${OUTPUT_FOLDER}"

                    # ALWAYS use BASE_NAME for file naming so test-and-run.sh can find it by *BASE_NAME*
                    file_stem="$BASE_NAME"
                    echo "[DEBUG] Using BASE_NAME for feature: $file_stem"

                    # Check if feature file with this stem already exists (excluding _previous folder), reuse its number
                    existing_feature=$(find "$feature_dir" -maxdepth 1 -name "*_${file_stem}.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -n 1)
                    if [ -n "$existing_feature" ]; then
                        # Extract the existing number prefix
                        existing_num=$(basename "$existing_feature" | grep -oE '^[0-9]+')
                        outpath="$feature_dir/${existing_num}_${file_stem}.feature"
                        echo "[DEBUG] Reusing existing feature number: $existing_num for stem: $file_stem"
                    else
                        # Look for backups to reuse their number (they were moved on retry)
                        backup_feature=$(find "$feature_dir/_previous" -name "*_${file_stem}_attempt_*.feature.txt" -type f 2>/dev/null | head -n 1)
                        if [ -n "$backup_feature" ]; then
                            # Extract the original number from backup filename (before _attempt)
                            existing_num=$(basename "$backup_feature" | grep -oE '^[0-9]+')
                            outpath="$feature_dir/${existing_num}_${file_stem}.feature"
                            echo "[DEBUG] Reusing number from backup: $existing_num for stem: $file_stem"
                        else
                            next_feature_num=$(get_next_prefix "$feature_dir" "*.feature")
                            outpath="$feature_dir/${next_feature_num}_${file_stem}.feature"
                            echo "[DEBUG] Assigned new feature number: $next_feature_num for stem: $file_stem"
                        fi
                    fi
                elif [ "$current_block_type" = "steps" ]; then
                    steps_count=$((steps_count + 1))
                    steps_dir="$AUTOMATION_DIR/tests/03_e2e/${OUTPUT_FOLDER}/steps"

                    # ALWAYS use BASE_NAME for file naming so test-and-run.sh can find it by *BASE_NAME*
                    steps_stem="$BASE_NAME"
                    echo "[DEBUG] Using BASE_NAME for steps: $steps_stem"

                    # Check if steps file already exists (excluding _previous folder), reuse its number
                    existing_steps=$(find "$steps_dir" -maxdepth 1 -name "*_${steps_stem}.steps.ts" -not -path "*/_previous/*" -type f 2>/dev/null | head -n 1)
                    if [ -n "$existing_steps" ]; then
                        # Extract the existing number prefix
                        existing_num=$(basename "$existing_steps" .steps.ts | grep -oE '^[0-9]+')
                        outpath="$steps_dir/${existing_num}_${steps_stem}.steps.ts"
                        echo "[DEBUG] Reusing existing steps number: $existing_num for stem: $steps_stem"
                    else
                        # Look for backups to reuse their number (they were moved on retry)
                        backup_steps=$(find "$steps_dir/_previous" -name "*_${steps_stem}_attempt_*.steps.ts.txt" -type f 2>/dev/null | head -n 1)
                        if [ -n "$backup_steps" ]; then
                            # Extract the original number from backup filename (before _attempt)
                            existing_num=$(basename "$backup_steps" | grep -oE '^[0-9]+')
                            outpath="$steps_dir/${existing_num}_${steps_stem}.steps.ts"
                            echo "[DEBUG] Reusing number from backup: $existing_num for stem: $steps_stem"
                        else
                            next_steps_num=$(get_next_prefix "$steps_dir" "*.steps.ts")
                            outpath="$steps_dir/${next_steps_num}_${steps_stem}.steps.ts"
                            echo "[DEBUG] Assigned new steps number: $next_steps_num for stem: $steps_stem"
                        fi
                    fi
                else
                    echo "[DEBUG] Skipped: unknown block type '$current_block_type'"
                    current_file=""
                    current_block_type=""
                    code_content=""
                    continue
                fi

                outdir=$(dirname "$outpath")
                mkdir -p "$outdir"

                # Track new folders for post-processing
                rel_folder=$(realpath --relative-to="$AUTOMATION_DIR/tests/03_e2e" "$outdir" 2>/dev/null || echo "$outdir")
                if [[ ! " ${new_folders[@]} " =~ " $rel_folder " ]]; then
                    new_folders+=("$rel_folder")
                fi

                echo "[DEBUG] Writing to: $outpath (content length: ${#code_content})"
                printf '%b' "$code_content" > "$outpath"
                if [ -f "$outpath" ]; then
                    echo -e "${GREEN}✓ Created feature file:${NC} ${CYAN}$(basename "$outpath")${NC}"
                    echo -e "  ${YELLOW}Path:${NC} ${CYAN}$outpath${NC}"
                    if [ "$current_block_type" = "feature" ]; then
                        sed -i '' 's|{config\.[^}]*}/|/|g' "$outpath" 2>/dev/null || true
                        sed -i '' 's|http://localhost:[0-9]*/|/|g' "$outpath" 2>/dev/null || true
                        sed -i '' 's|I navigate to |I open the Xyne-Space at |g' "$outpath" 2>/dev/null || true
                        actual_feature_path="$outpath"
                        all_generated_features+=("$outpath")
                    elif [ "$current_block_type" = "steps" ]; then
                        actual_steps_path="$outpath"
                        all_generated_steps+=("$outpath")
                        echo -e "${GREEN}✓ Created steps file:${NC} ${CYAN}$(basename "$outpath")${NC}"
                        echo -e "  ${YELLOW}Path:${NC} ${CYAN}$outpath${NC}"
                    fi
                else
                    echo "WARNING: File not created: $outpath"
                fi
            else
                echo "[DEBUG] Skipped writing: empty code_content"
            fi
        elif [[ "$trimmed_line" =~ ^\`\`\` ]]; then
            # Other code blocks (like json, bash, etc.) - skip them
            if [ $inside_code -eq 0 ]; then
                inside_code=2  # Mark as "other" code block to skip
                echo "[DEBUG] Skipping non-target code block (line: $trimmed_line)"
            else
                inside_code=0
                echo "[DEBUG] Ending skipped code block"
            fi
            continue
        fi

        # Collect code lines only for target block types
        if [ $inside_code -eq 1 ]; then
            code_content="${code_content}${line}\n"
        fi
    done < "$LLM_OUTPUT_FILE"

    echo "[DEBUG] Parsing complete: feature_count=$feature_count, steps_count=$steps_count"
    echo "[DEBUG]   actual_feature_path=${actual_feature_path:-<empty>}"
    echo "[DEBUG]   actual_steps_path=${actual_steps_path:-<empty>}"

    # If we have a feature but no steps, create a minimal steps file
    if [ -n "$actual_feature_path" ] && [ -z "$actual_steps_path" ]; then
        echo -e "${YELLOW}⚠ No steps file generated by LLM — creating minimal steps file${NC}"
        _feat_dir=$(dirname "$actual_feature_path")
        _steps_dir="${_feat_dir}/steps"
        mkdir -p "$_steps_dir"
        _steps_file="${_steps_dir}/01_${BASE_NAME}.steps.ts"
        _existing_steps=$(find "$_steps_dir" -maxdepth 1 -name "*_${BASE_NAME}.steps.ts" -not -path "*/_previous/*" -type f 2>/dev/null | head -n 1)
        if [ -n "$_existing_steps" ]; then
            _steps_file="$_existing_steps"
            echo -e "${CYAN}  Using existing steps file: $(basename "$_steps_file")${NC}"
        else
            cat > "$_steps_file" << 'MINIMAL_STEPS_EOF'
import { CustomWorld } from '../../../fixtures/cucumber.world';
// All steps are defined in shared step files (common.steps.ts, browser.steps.ts, e2e-common.steps.ts)
// No additional step definitions needed for this feature.
MINIMAL_STEPS_EOF
            echo -e "${GREEN}✓ Created minimal steps file:${NC} ${CYAN}$(basename "$_steps_file")${NC}"
        fi
        actual_steps_path="$_steps_file"
        all_generated_steps+=("$_steps_file")
    fi

    if [ -n "$actual_feature_path" ] || [ -n "$actual_steps_path" ]; then
        echo ""
        echo -e "${GREEN}✓ Successfully generated files for: $INPUT_FILE${NC}"
        if [ ${#all_generated_features[@]} -gt 1 ] || [ ${#all_generated_steps[@]} -gt 1 ]; then
            echo -e "${CYAN}  Generated ${#all_generated_features[@]} feature file(s) and ${#all_generated_steps[@]} steps file(s):${NC}"
            for gf in "${all_generated_features[@]}"; do
                echo -e "    ${YELLOW}Feature:${NC} ${CYAN}$(basename "$gf")${NC}"
            done
            for gs in "${all_generated_steps[@]}"; do
                echo -e "    ${YELLOW}Steps:${NC}   ${CYAN}$(basename "$gs")${NC}"
            done
        fi
        if [ ${#EXISTING_FEATURE_NAMES[@]} -gt 0 ]; then
            echo -e "${CYAN}  Pre-existing features (unchanged): ${EXISTING_FEATURE_NAMES[*]}${NC}"
        fi
        if [ ${#EXISTING_STEPS_NAMES[@]} -gt 0 ]; then
            echo -e "${CYAN}  Pre-existing steps (unchanged): ${EXISTING_STEPS_NAMES[*]}${NC}"
        fi

        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        FINAL_FEATURE_PATHS+=("${actual_feature_path:-}")
        FINAL_STEPS_PATHS+=("${actual_steps_path:-}")

        echo -e "  ${YELLOW}Feature written to:${NC} ${CYAN}${actual_feature_path}${NC}"
        echo -e "  ${YELLOW}Steps written to:${NC}   ${CYAN}${actual_steps_path}${NC}"

        # Generate run command with prerequisites
        FEATURE_REL_PATH=$(python3 -c "import os; print(os.path.relpath('$actual_feature_path', '$AUTOMATION_DIR'))" 2>/dev/null || echo "$actual_feature_path")

        # Detect tags needed for prerequisites
        FEATURE_CONTENT=$(cat "$actual_feature_path" 2>/dev/null || echo "")
        TAGS="@setup"

        # Resource creation tags based on what the test uses
        if echo "$FEATURE_CONTENT" | grep -qE 'user1-channel|channel.*join|join.*channel|tab-channels'; then
            TAGS="$TAGS or @channel-create"
        fi
        if echo "$FEATURE_CONTENT" | grep -qE 'user1-user2-dm|create.*dm|dm.*create'; then
            TAGS="$TAGS or @dm-create"
        fi
        if echo "$FEATURE_CONTENT" | grep -qE 'group-chat-1|group.*chat'; then
            TAGS="$TAGS or @group-chat-create"
        fi

        # Get the feature-specific tag from the feature file
        FEATURE_TAG=$(grep -oE '^@[a-zA-Z0-9_-]+' "$actual_feature_path" 2>/dev/null | head -1 | sed 's/^@//' || echo "")

        echo ""
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}📋 Available Run Commands:${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        # Build the run commands
        if [ -n "$FEATURE_TAG" ]; then
            CMD_WITH_PREREQ="npx cucumber-js --tags \"$TAGS or @$FEATURE_TAG\" --profile e2e"
            CMD_FEATURE_ONLY="npx cucumber-js --tags \"@$FEATURE_TAG\" --profile e2e"
            CMD_FULL_E2E="npx cucumber-js --tags \"@e2e\" --profile e2e"

            echo -e "${YELLOW}1) With prerequisites (includes setup + resource creation):${NC}"
            echo -e "   ${GREEN}$CMD_WITH_PREREQ${NC}"
            echo ""
            echo -e "${YELLOW}2) Feature only (if prerequisites already running):${NC}"
            echo -e "   ${GREEN}$CMD_FEATURE_ONLY${NC}"
            echo ""
            echo -e "${YELLOW}3) Full e2e suite (all e2e tests):${NC}"
            echo -e "   ${GREEN}$CMD_FULL_E2E${NC}"
        else
            CMD_WITH_PREREQ="npx cucumber-js --tags \"$TAGS\" --profile e2e $FEATURE_REL_PATH"
            CMD_FULL_E2E="npx cucumber-js --tags \"@e2e\" --profile e2e"

            echo -e "${YELLOW}1) With prerequisites:${NC}"
            echo -e "   ${GREEN}$CMD_WITH_PREREQ${NC}"
            echo ""
            echo -e "${YELLOW}2) Full e2e suite (all e2e tests):${NC}"
            echo -e "   ${GREEN}$CMD_FULL_E2E${NC}"
        fi
        echo ""

        # Ask user which command to run
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}Do you want to run any of these commands now?${NC}"
        echo ""
        if [ -n "$FEATURE_TAG" ]; then
            echo -e "  ${CYAN}1)${NC} Run with prerequisites"
            echo -e "  ${CYAN}2)${NC} Run feature only (prerequisites already done)"
            echo -e "  ${CYAN}3)${NC} Run full e2e suite"
            echo -e "  ${CYAN}4)${NC} Skip - don't run now"
        else
            echo -e "  ${CYAN}1)${NC} Run with prerequisites"
            echo -e "  ${CYAN}2)${NC} Run full e2e suite"
            echo -e "  ${CYAN}3)${NC} Skip - don't run now"
        fi
        echo ""
        echo -n -e "${YELLOW}Choose [1/2/3/4 or 1/2/3]: ${NC}"
        read -r RUN_CHOICE < /dev/tty
        RUN_CHOICE=$(echo "$RUN_CHOICE" | tr -d '[:space:]')

        echo ""
        if [ -n "$FEATURE_TAG" ]; then
            case "$RUN_CHOICE" in
                1)
                    echo -e "${GREEN}Running: $CMD_WITH_PREREQ${NC}"
                    echo ""
                    cd "$AUTOMATION_DIR" && eval "$CMD_WITH_PREREQ"
                    ;;
                2)
                    echo -e "${GREEN}Running: $CMD_FEATURE_ONLY${NC}"
                    echo ""
                    cd "$AUTOMATION_DIR" && eval "$CMD_FEATURE_ONLY"
                    ;;
                3)
                    echo -e "${GREEN}Running: $CMD_FULL_E2E${NC}"
                    echo ""
                    cd "$AUTOMATION_DIR" && eval "$CMD_FULL_E2E"
                    ;;
                4|"")
                    echo -e "${CYAN}Skipping test execution. You can run the commands manually later.${NC}"
                    ;;
                *)
                    echo -e "${CYAN}Skipping test execution. You can run the commands manually later.${NC}"
                    ;;
            esac
        else
            case "$RUN_CHOICE" in
                1)
                    echo -e "${GREEN}Running: $CMD_WITH_PREREQ${NC}"
                    echo ""
                    cd "$AUTOMATION_DIR" && eval "$CMD_WITH_PREREQ"
                    ;;
                2)
                    echo -e "${GREEN}Running: $CMD_FULL_E2E${NC}"
                    echo ""
                    cd "$AUTOMATION_DIR" && eval "$CMD_FULL_E2E"
                    ;;
                3|"")
                    echo -e "${CYAN}Skipping test execution. You can run the commands manually later.${NC}"
                    ;;
                *)
                    echo -e "${CYAN}Skipping test execution. You can run the commands manually later.${NC}"
                    ;;
            esac
        fi
        echo ""

        rm -f "$TEMP_PROMPT_FILE"
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_FILES+=("$INPUT_FILE")
        echo ""
        echo -e "${RED}✗ Failed to process: $INPUT_FILE${NC}"
        echo -e "${RED}  No feature or steps code blocks found in LLM output.${NC}"
        echo -e "${YELLOW}  The LLM may have described the files instead of outputting code blocks.${NC}"
        echo -e "${YELLOW}  Check the LLM debug output for details:${NC}"
        echo -e "${YELLOW}    $LLM_OUTPUT_FILE${NC}"
        rm -f "$TEMP_PROMPT_FILE"
    fi
    echo ""
done

# Summary
echo "=========================================="
echo "  Summary"
echo "=========================================="
echo -e "${GREEN}✓ Successful: $SUCCESS_COUNT${NC}"
if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "${RED}✗ Failed: $FAILED_COUNT${NC}"
    echo ""
    echo "Failed files:"
    for file in "${FAILED_FILES[@]}"; do
        echo -e "${RED}  - $file${NC}"
    done
fi
echo ""

if [ $FAILED_COUNT -gt 0 ]; then
    exit 1
fi

echo -e "${GREEN}All files processed successfully!${NC}"

# Display results for each processed file
for i in "${!FINAL_FEATURE_PATHS[@]}"; do
    fp="${FINAL_FEATURE_PATHS[$i]}"
    sp="${FINAL_STEPS_PATHS[$i]}"

    if [ -z "$fp" ] && [ -z "$sp" ]; then
        continue
    fi

    WAITED=0
    echo -e "${CYAN}Waiting for generated files...${NC}"
    [ -n "$fp" ] && echo -e "  ${YELLOW}FEATURE_PATH:${NC} ${CYAN}${fp}${NC}"
    [ -n "$sp" ] && echo -e "  ${YELLOW}STEPS_PATH:${NC} ${CYAN}${sp}${NC}"

    while { { [ -n "$fp" ] && [ ! -f "$fp" ]; } || { [ -n "$sp" ] && [ ! -f "$sp" ]; }; } && [ $WAITED -lt $MAX_WAIT ]; do
        sleep 1
        WAITED=$((WAITED + 1))
    done

    if { [ -n "$fp" ] && [ ! -f "$fp" ]; } || { [ -n "$sp" ] && [ ! -f "$sp" ]; }; then
        echo -e "${RED}Timeout waiting for generated files!${NC}"
        [ -n "$fp" ] && [ ! -f "$fp" ] && echo -e "  ${RED}Missing:${NC} ${CYAN}$fp${NC}"
        [ -n "$sp" ] && [ ! -f "$sp" ] && echo -e "  ${RED}Missing:${NC} ${CYAN}$sp${NC}"
        echo ""
        echo -e "${YELLOW}Check the LLM debug output for details:${NC}"
        echo -e "  ${CYAN}$LLM_OUTPUT_FILE${NC}"
        echo -e "${YELLOW}This file contains the raw LLM response. Look for code blocks or file paths that may not have been parsed correctly.${NC}"
        exit 1
    fi

    echo ""
    echo -e "${GREEN}Generated files:${NC}"
    if [ -n "$fp" ]; then
        echo -e "  ${YELLOW}Feature:${NC} ${CYAN}$fp${NC}"
    fi
    if [ -n "$sp" ]; then
        echo -e "  ${YELLOW}Steps:${NC} ${CYAN}$sp${NC}"
    fi
done
