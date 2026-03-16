#!/bin/bash
# chmod +x this file if needed: chmod +x scripts/add-testid-llm.sh

# LLM-based data-testid addition
# Uses Claude Code in agent mode to search dashboard components, add data-testid attributes,
# and update the spec file to use getByTestId() — Claude does all file discovery itself.
#
# Usage: ./add-testid-llm.sh <playwright-spec-file> <dashboard-src-dir>

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Track background processes for cleanup
TIMER_PID=""
TAIL_PID=""

# Cleanup function to kill background processes
cleanup() {
    echo -e "\n${YELLOW}Cleaning up background processes...${NC}"
    [ -n "$TIMER_PID" ] && kill $TIMER_PID 2>/dev/null || true
    [ -n "$TAIL_PID" ] && kill $TAIL_PID 2>/dev/null || true
    exit 130
}

# Trap Ctrl+C and cleanup
trap cleanup INT TERM

if [ "$#" -lt 2 ]; then
    echo -e "${RED}Usage: $0 <playwright-spec-file> <dashboard-src-dir>${NC}"
    exit 1
fi

SPEC_FILE="$1"
DASHBOARD_SRC="$2"

if [ ! -f "$SPEC_FILE" ]; then
    echo -e "${RED}✗ Spec file not found: $SPEC_FILE${NC}"
    exit 1
fi

if [ ! -d "$DASHBOARD_SRC" ]; then
    echo -e "${RED}✗ Dashboard source directory not found: $DASHBOARD_SRC${NC}"
    exit 1
fi

SPEC_BASENAME=$(basename "$SPEC_FILE")
SPEC_DIR=$(dirname "$SPEC_FILE")

# Load environment variables from .env if present
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

echo "=========================================="
echo "  LLM-based TestID Addition"
echo "=========================================="
echo ""

# Initialize LLM output/report file early so all steps can log to it
LLM_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LLM_DEBUG_DIR="$AUTOMATION_DIR/llm_reports/testid_debug"
mkdir -p "$LLM_DEBUG_DIR"
LLM_OUTPUT_FILE="$LLM_DEBUG_DIR/testid_${SPEC_BASENAME%.spec.ts}_${LLM_TIMESTAMP}.txt"

{
    echo "=========================================="
    echo "  LLM-based TestID Addition Report"
    echo "=========================================="
    echo "Timestamp: $(date)"
    echo "Spec file: $SPEC_FILE"
    echo "Dashboard src: $DASHBOARD_SRC"
    echo "Model: $MODEL"
    echo ""
} > "$LLM_OUTPUT_FILE"

echo -e "${CYAN}Report file: $LLM_OUTPUT_FILE${NC}"
echo ""
echo -e "${CYAN}Spec file: $SPEC_FILE${NC}"
echo -e "${CYAN}Dashboard src: $DASHBOARD_SRC${NC}"
echo -e "${CYAN}Model: $MODEL${NC}"
echo ""

# ============================================================
# Step 1: Verify existing getByTestId selectors exist in dashboard
# ============================================================
echo -e "${CYAN}Step 1: Verifying existing getByTestId selectors in dashboard...${NC}"

EXISTING_TESTIDS=$(grep -oE "getByTestId\('[^']+'\)" "$SPEC_FILE" 2>/dev/null | grep -oE "'[^']+'" | sed "s/'//g" | sort -u || true)
MISSING_TESTIDS=()

if [ -n "$EXISTING_TESTIDS" ]; then
    while IFS= read -r testid; do
        [ -z "$testid" ] && continue
        # Search for data-testid="<testid>" or data-testid='<testid>' or data-testid={...testid...} in dashboard
        found=$(grep -rl --include="*.tsx" --include="*.jsx" --include="*.ts" "data-testid=['\"]${testid}['\"]" "$DASHBOARD_SRC" 2>/dev/null | head -1 || true)
        if [ -z "$found" ]; then
            # Also check for dynamic testid patterns like data-testid={`...-${...}`}
            found=$(grep -rl --include="*.tsx" --include="*.jsx" "$testid" "$DASHBOARD_SRC" 2>/dev/null | head -1 || true)
        fi
        if [ -n "$found" ]; then
            rel_path=$(python3 -c "import os; print(os.path.relpath('$found', '$DASHBOARD_SRC'))" 2>/dev/null || basename "$found")
            echo -e "  ${GREEN}✓${NC} ${testid} → ${CYAN}${rel_path}${NC}"
        else
            echo -e "  ${RED}✗${NC} ${testid} → ${RED}NOT FOUND in dashboard${NC}"
            MISSING_TESTIDS+=("$testid")
        fi
    done <<< "$EXISTING_TESTIDS"
else
    echo -e "  ${YELLOW}No existing getByTestId selectors found${NC}"
fi

if [ ${#MISSING_TESTIDS[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠ ${#MISSING_TESTIDS[@]} testid(s) used in spec but NOT found in dashboard:${NC}"
    for mid in "${MISSING_TESTIDS[@]}"; do
        echo -e "  ${RED}  - data-testid=\"${mid}\"${NC}"
    done
    echo -e "${YELLOW}  These will be included in the Claude prompt for addition.${NC}"
fi
echo ""

# Log verification results to report (plain text, no color codes)
{
    echo "Step 1: Existing getByTestId verification"
    echo "-------------------------------------------"
    if [ -n "$EXISTING_TESTIDS" ]; then
        while IFS= read -r testid; do
            [ -z "$testid" ] && continue
            found=$(grep -rl --include="*.tsx" --include="*.jsx" --include="*.ts" "data-testid=['\"]${testid}['\"]" "$DASHBOARD_SRC" 2>/dev/null | head -1 || true)
            if [ -z "$found" ]; then
                found=$(grep -rl --include="*.tsx" --include="*.jsx" "$testid" "$DASHBOARD_SRC" 2>/dev/null | head -1 || true)
            fi
            if [ -n "$found" ]; then
                rel_path=$(python3 -c "import os; print(os.path.relpath('$found', '$DASHBOARD_SRC'))" 2>/dev/null || basename "$found")
                echo "  ✓ ${testid} → ${rel_path}"
            else
                echo "  ✗ ${testid} → NOT FOUND"
            fi
        done <<< "$EXISTING_TESTIDS"
    fi
    if [ ${#MISSING_TESTIDS[@]} -gt 0 ]; then
        echo ""
        echo "Missing testids to add:"
        for mid in "${MISSING_TESTIDS[@]}"; do
            echo "  - ${mid}"
        done
    fi
    echo ""
} >> "$LLM_OUTPUT_FILE"

# ============================================================
# Step 2: Extract selectors from spec file that need testids
# ============================================================
echo -e "${CYAN}Step 2: Analyzing spec file for selectors needing testid...${NC}"

SELECTORS=$(grep -noE "getBy(Role|Text|Label|Placeholder)\([^)]+\)" "$SPEC_FILE" 2>/dev/null || true)

if [ -z "$SELECTORS" ]; then
    if [ ${#MISSING_TESTIDS[@]} -gt 0 ]; then
        echo -e "${GREEN}✓ No selectors need conversion — all already use getByTestId()${NC}"
        echo ""
        echo -e "${YELLOW}⚠ However, ${#MISSING_TESTIDS[@]} testid(s) need to be added to dashboard components.${NC}"
        echo -e "${CYAN}Proceeding to add missing testids to dashboard...${NC}"
        SELECTOR_COUNT=0
    else
        echo -e "${GREEN}✓ All selectors use getByTestId() and all testids exist in dashboard. Nothing to do.${NC}"
        exit 0
    fi
else
    SELECTOR_COUNT=$(echo "$SELECTORS" | wc -l | tr -d ' ')
    echo -e "${YELLOW}  Found $SELECTOR_COUNT selector(s) that need data-testid:${NC}"
    echo "$SELECTORS" | while IFS= read -r sel_line; do
        echo -e "    ${CYAN}${sel_line}${NC}"
    done
fi
echo ""

# Log selectors to report (plain text, no color codes)
{
    echo "Step 2: Selectors needing testid"
    echo "-------------------------------------------"
    echo "Found $SELECTOR_COUNT selector(s):"
    echo "$SELECTORS"
    echo ""
} >> "$LLM_OUTPUT_FILE"

# ============================================================
# Step 3: Backup spec file
# ============================================================
echo -e "${CYAN}Step 3: Backing up original files...${NC}"

SPEC_BACKUP="${SPEC_FILE}_original"
if [ ! -f "$SPEC_BACKUP" ]; then
    cp "$SPEC_FILE" "$SPEC_BACKUP"
    echo -e "  ${GREEN}✓ Backed up: ${SPEC_BASENAME} → ${SPEC_BASENAME}_original${NC}"
else
    echo -e "  ${CYAN}Backup already exists: ${SPEC_BASENAME}_original${NC}"
fi
echo ""

# ============================================================
# Step 4: Run Claude in interactive agent mode
# ============================================================
echo -e "${CYAN}Step 4: Running Claude Code (interactive agent mode)...${NC}"
echo -e "${CYAN}  Claude will search the dashboard codebase, find components, and add testids.${NC}"
echo ""

printf '\e[?1004l'

# Build the prompt as a single string
MISSING_TESTIDS_TEXT=""
if [ ${#MISSING_TESTIDS[@]} -gt 0 ]; then
    MISSING_TESTIDS_TEXT="

## IMPORTANT — Missing testids that need to be added:
The following data-testid values are used in the spec file (via getByTestId) but do NOT exist in the dashboard source code.
You MUST find the correct component and add these data-testid attributes:
"
    for mid in "${MISSING_TESTIDS[@]}"; do
        MISSING_TESTIDS_TEXT="${MISSING_TESTIDS_TEXT}
- data-testid=\"${mid}\""
    done
fi

PROMPT="I have a Playwright spec file at '${SPEC_FILE}'. The dashboard source code is at '${DASHBOARD_SRC}'.
${MISSING_TESTIDS_TEXT}

## Your approach — trace the user flow:

1. Read the spec file first
2. Go through the test STEP BY STEP, understanding the user journey:
   - What page/route is the user on?
   - What did they click/type before this step?
   - What modal/form/panel would be open at this point?
   - This context tells you WHICH component renders the element
3. For example, if the test does:
   - click 'create-new-channel' → opens AddChannelForm
   - then click button 'Cancel' → that Cancel button is INSIDE AddChannelForm
   So you search for AddChannelForm and find the Cancel button there.
4. Similarly, if the test does:
   - click 'create-new-dm' → opens DM creation flow
   - then types in a search input → that input is in the DM creation component
   - then clicks a user name → that's in the search results
   - then clicks in Message textbox → that's in the DM/chat message input

## For EACH selector using getByRole(), getByText(), getByLabel(), or getByPlaceholder():

1. Use the flow context above to identify which component/page would contain this element
2. Search under '${DASHBOARD_SRC}' to find that component file
3. Add a data-testid attribute to the element in the dashboard component
4. Update the spec file to use getByTestId('...') instead

## Rules:
- data-testid naming: kebab-case with element type suffix (cancel-btn, search-input, mention-user-btn)
- Prefix with component context (e.g. create-channel-cancel-btn, dm-message-input)
- If element ALREADY has data-testid, just update the spec to use that existing testid — do NOT add a duplicate
- Do NOT change any other code, logic, or formatting — only add data-testid and update selectors
- If you truly cannot find the component, leave that selector unchanged in the spec
- NEVER convert dynamic/list-rendered items to getByTestId in the spec file, even if they have dynamic data-testid attributes (e.g. data-testid={\`mention-item-\${item.id}\`})
- Dynamic items include: elements inside .map(), .forEach(), list rendering, search results, user lists, role lists, channel lists, mention popover items, dropdown options populated from API data
- For these dynamic items, LEAVE the original getByRole()/getByText() selector AS-IS in the spec file, text-based selectors are more reliable for items whose testid values depend on runtime data
- Only add/use data-testid for STATIC elements: buttons, inputs, textareas, forms, icons that are always present with fixed content

After making all changes, print a summary:
TESTID_SUMMARY:
- original selector → getByTestId('new-id') [ComponentFile.tsx]
- original selector → SKIPPED (reason)"

# Find the common workspace root that contains both automation and dashboard dirs
WORKSPACE_ROOT=""
if [ -d "$AUTOMATION_DIR/../dashboard" ]; then
    WORKSPACE_ROOT="$(cd "$AUTOMATION_DIR/.." && pwd)"
elif [ -d "$AUTOMATION_DIR/../../dashboard" ]; then
    WORKSPACE_ROOT="$(cd "$AUTOMATION_DIR/../.." && pwd)"
fi

if [ -z "$WORKSPACE_ROOT" ]; then
    echo -e "${YELLOW}⚠ Could not find workspace root containing both automation and dashboard${NC}"
    echo -e "${YELLOW}  Claude may not have access to dashboard files${NC}"
    WORKSPACE_ROOT="$AUTOMATION_DIR"
fi

# Log prompt to report
{
    echo "Step 4: Prompt sent to Claude"
    echo "-------------------------------------------"
    echo "Working directory: ${WORKSPACE_ROOT}"
    echo ""
    echo "$PROMPT"
    echo ""
    echo "==========================================" 
    echo "Claude Agent Output:"
    echo "=========================================="
} >> "$LLM_OUTPUT_FILE"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━ Claude Agent Output ━━━━━━━━━━━━━━━━━${NC}"

# Start a background tail to show output live as Claude writes to the file
touch "$LLM_OUTPUT_FILE"
tail -f "$LLM_OUTPUT_FILE" &
TAIL_PID=$!

# Start elapsed timer in background
SECONDS=0
(
    while true; do
        sleep 1
        elapsed=$SECONDS
        mins=$((elapsed / 60))
        secs=$((elapsed % 60))
        if [ $mins -gt 0 ]; then
            printf "\r  ${YELLOW}⏱ Elapsed: %dm %02ds ${NC}" "$mins" "$secs" >&2
        else
            printf "\r  ${YELLOW}⏱ Elapsed: %ds ${NC}" "$secs" >&2
        fi
    done
) &
TIMER_PID=$!

# Save current dir and cd to workspace root so Claude has access to both dirs
ORIG_DIR="$(pwd)"
if [ -n "$WORKSPACE_ROOT" ]; then
    cd "$WORKSPACE_ROOT"
    echo -e "${CYAN}  Working directory: $WORKSPACE_ROOT${NC}"
    echo -e "${CYAN}  Model: $MODEL${NC}"
fi

set +e
# Run Claude in interactive agent mode — from workspace root so it can access both dirs
# --dangerously-skip-permissions: skip interactive permission prompts (output is redirected)
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
    # ANTHROPIC_LOG=debug \
    claude --dangerously-skip-permissions "$PROMPT" \
    >> "$LLM_OUTPUT_FILE" 2>&1
LLM_EXIT_CODE=$?
set -e

# Restore original directory
cd "$ORIG_DIR"

# Kill timer and tail
kill $TIMER_PID 2>/dev/null || true
wait $TIMER_PID 2>/dev/null || true
kill $TAIL_PID 2>/dev/null || true
wait $TAIL_PID 2>/dev/null || true

# Show final elapsed time
elapsed=$SECONDS
mins=$((elapsed / 60))
secs=$((elapsed % 60))
echo ""
if [ $mins -gt 0 ]; then
    echo -e "  ${GREEN}⏱ Completed in ${mins}m ${secs}s${NC}"
else
    echo -e "  ${GREEN}⏱ Completed in ${secs}s${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━ End Claude Agent Output ━━━━━━━━━━━━━${NC}"
echo ""

echo ""
echo -e "${CYAN}Full output saved to: $LLM_OUTPUT_FILE${NC}"

if [ $LLM_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}✗ Claude agent failed (exit code: $LLM_EXIT_CODE)${NC}"
    echo -e "${YELLOW}Last 20 lines of output:${NC}"
    tail -20 "$LLM_OUTPUT_FILE" 2>/dev/null
    exit 1
fi

# ============================================================
# Step 5: Verify changes were made
# ============================================================
echo ""
echo -e "${CYAN}Step 5: Verifying changes...${NC}"

# Check if spec file was modified
if [ -f "$SPEC_BACKUP" ] && ! diff -q "$SPEC_FILE" "$SPEC_BACKUP" > /dev/null 2>&1; then
    CHANGED_SELECTORS=$(diff "$SPEC_BACKUP" "$SPEC_FILE" | grep -c "getByTestId" 2>/dev/null || echo "0")
    echo -e "  ${GREEN}✓ Spec file modified ($CHANGED_SELECTORS new getByTestId selectors)${NC}"
else
    echo -e "  ${YELLOW}⚠ Spec file unchanged — Claude may not have found matching components${NC}"
fi

# Show summary if present in output
if grep -q "TESTID_SUMMARY" "$LLM_OUTPUT_FILE" 2>/dev/null; then
    echo ""
    echo "=========================================="
    echo "  TestID Summary"
    echo "=========================================="
    sed -n '/TESTID_SUMMARY/,/^$/p' "$LLM_OUTPUT_FILE" | while IFS= read -r sum_line; do
        if echo "$sum_line" | grep -q "SKIPPED"; then
            echo -e "  ${YELLOW}${sum_line}${NC}"
        elif echo "$sum_line" | grep -q "→"; then
            echo -e "  ${GREEN}${sum_line}${NC}"
        else
            echo -e "  ${CYAN}${sum_line}${NC}"
        fi
    done
fi

echo ""
echo -e "${GREEN}✓ Done.${NC}"
echo -e "${CYAN}  Original spec backed up: ${SPEC_BACKUP}${NC}"
echo -e "${CYAN}  LLM debug: $LLM_OUTPUT_FILE${NC}"

exit 0
