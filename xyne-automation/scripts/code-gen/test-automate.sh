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
export MODEL="glm-latest"
# export MODEL="kimi-latest"

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
            echo -e "${RED}Warning: --retry-folder not provided with --dry-run-report${NC}"
            echo -e "${YELLOW}  The script will re-analyze folder placement instead of using the previous folder.${NC}"
        else
            echo -e "${YELLOW}Retrying with folder:${NC} ${CYAN}$RETRY_FOLDER${NC}"
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
                next_num=$(get_next_prefix "$E2E_DIR" "*/")
                OUTPUT_FOLDER="${next_num}_${NEW_FOLDER_SUGGESTION}"
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
        
        next_num=$(get_next_prefix "$E2E_DIR" "*/")
        OUTPUT_FOLDER="${next_num}_${NEW_FOLDER_NAME}"
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
- BEFORE writing any step definition, check the QUICK REFERENCE list below (which includes ALL step patterns from ALL e2e folders). If the pattern is there, DO NOT define it.
- If a step you need is already defined in another folder's steps file, just USE it in your .feature file — do NOT redefine it.

### Rule 3 — Steps File: Define All New Steps
- For EVERY step phrase in the .feature file that is NOT in the QUICK REFERENCE list, you MUST generate a matching step definition in the .steps.ts file.
- The step definition string must match the feature file step phrase EXACTLY, character for character.
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

**CRITICAL**: `getByTestId('dm-message-input')` → `I click on "[data-testid='dm-message-input']"` — NEVER convert this to `I click the textbox with name "Message (optional)"` or any other role/text step. The testid IS the selector.

**NEVER** do this:
- ❌ `getByTestId('dm-message-input')` → `I click the textbox with name "Message (optional)"` (WRONG — reverting testid to role selector)
- ❌ `getByText('John')` → `I click on "[data-testid='john-btn']"` (WRONG — inventing testid that doesn't exist in spec)
- ✅ `getByTestId('dm-message-input')` → `I click on "[data-testid='dm-message-input']"` (CORRECT)
- ✅ `getByTestId('dm-message-input').fill('hello')` → `I type "hello" on the element "[data-testid='dm-message-input']"` (CORRECT)
- ✅ `getByText('hello')` → `I click on text "hello"` (CORRECT — faithful conversion)
- ✅ `getByRole('button', { name: 'Save' })` → `I click the button with text "Save"` (CORRECT — faithful conversion)

### Rule 5 — TypeScript & Null Checks
- Every step using `this.page` must include: `if (!this.page) throw new Error('Browser not initialized');`
- Inside `.catch()`, `.then()`, or callbacks, re-add the null check before using `this.page`.
- The .steps.ts file MUST compile with zero TypeScript errors.
- Use Playwright APIs correctly. Prefer `this.page.locator('selector').click()` over waitForSelector chains.
- Do NOT access properties that do not exist on Config, CustomWorld, Page, or Locator types.

### Rule 6 — Dynamic Data (No Hardcoding)
- Use `this.config.dashboard.baseUrl` instead of hardcoded URLs.
- Use `this.config.backend.baseUrl` for backend URLs.
- Use `this.config.timeout` for timeouts.
- Use `this.userData.set()` / `this.userData.get()` to store/retrieve data between steps (with proper null checks).
- Do NOT invent properties like `this.config.testData`.
- Hardcoded values ARE allowed in Scenario Outline Examples tables.
- **CRITICAL — Dynamic selectors**: If a Playwright test references an element by a user-specific name (e.g., `img[name='Amrit Raj']`, `text='John Doe'`), do NOT hardcode the name in the .feature file. Instead:
  - Use a parameterized step with {string} in the .feature file where the value comes from stored user data or config.
  - Or create a step that dynamically finds the element without relying on a specific name (e.g., "I click on the user avatar" which finds the logged-in user's avatar automatically).
  - In the step definition, resolve dynamic values using `this.userData.get()` or by querying the page for the current user's info.
  - Example: Instead of `And I click on img "Naveen Yallattikar"`, use `And I click on the user avatar` with a step definition that clicks the avatar of the currently logged-in user.

### Rule 7 — Structure & Naming
- Use existing browser names (e.g., "user1-browser", "user2-browser", "user3-browser", "admin-browser", "e2e-browser1") unless a different user is explicitly mentioned.
- **CRITICAL — Browser Initialization vs Browser Context**:
  - If the browser has NOT been initialized yet (first use in the test), you MUST first create it and then set context:
    ```gherkin
    Given a browser "e2e-browser1" with viewport 1280x720
    And using browser "e2e-browser1"
    ```
    The browser name can be any descriptive name (e.g., "user1-browser", "admin-browser", "e2e-browser1").
    The viewport can be adjusted as needed (e.g., 1920x1080, 1280x720).
  - If the browser has ALREADY been initialized (in a previous scenario, Background, or earlier step), just switch to it:
    ```gherkin
    Given using browser "user2-browser"
    ```
  - Use `Background:` to initialize browsers that are shared across all scenarios in the feature file. Then each scenario only needs `Given using browser "<name>"`.
  - If a scenario involves multiple browsers, switch context mid-scenario with `Given using browser "<other-browser>"`.
  - Do NOT use `Given using browser "<name>"` without first initializing the browser somewhere (Background or earlier scenario/step).
- Include appropriate @tags at the top of the feature file.
- Match existing import style, folder layout, and naming patterns.
- Do not use number prefixes for folders or files — the automation script assigns them.

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

### Rule 9 — Electron/Desktop Elements
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

You MUST output BOTH files with complete content inside fenced code blocks:

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
    echo "If your feature file uses a step that is NOT in the list above, you MUST define it in your .steps.ts file." >> "$TEMP_PROMPT_FILE"
    echo "If your feature file uses a step that IS in the list above, DO NOT define it — it will be loaded automatically." >> "$TEMP_PROMPT_FILE"
    echo "" >> "$TEMP_PROMPT_FILE"

    # Add explicit instruction about URL handling
    NAVIGATION_RULE="IMPORTANT: For page.goto() calls, use the step 'I open the Xyne-Space at \"/path\"' with ONLY the relative path (e.g., \"/auth\", \"/dashboard\"). Do NOT use 'I navigate to' — that step does NOT exist. Do NOT include base URL, config variables like {config.dashboard.baseUrl}, or localhost references. Just the path.
Example: When I open the Xyne-Space at \"/auth\""

    echo "" >> "$TEMP_PROMPT_FILE"
    echo "## Navigation URL Handling:" >> "$TEMP_PROMPT_FILE"
    echo '```' >> "$TEMP_PROMPT_FILE"
    echo "$NAVIGATION_RULE" >> "$TEMP_PROMPT_FILE"
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
