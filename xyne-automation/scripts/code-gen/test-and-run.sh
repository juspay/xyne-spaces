#!/bin/bash

# Test and Run Script - Converts Playwright specs to Cucumber BDD and runs them
# Usage: npm run codegen-and-test -- <spec-file.spec.ts> [<spec-file2.spec.ts> ...]

set -e

# Function to cleanup all child processes
cleanup() {
    echo -e "\n${YELLOW}Interrupted! Cleaning up...${NC}"
    # Kill entire process group
    kill -- -$$ 2>/dev/null || true
    # Also try pkill for any orphaned processes
    pkill -P $$ 2>/dev/null || true
    exit 130
}

# Trap Ctrl+C and kill all child processes
trap cleanup INT TERM

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Track success/failure
SPEC_FILES=()
GENERATED_FEATURES=()
TAGS_TO_RUN="@setup"
FAILED_FILES=()
SUCCESSFUL_FILES=()

SCRIPT_START_TIME=$(date +%s)

format_time() {
    local SECONDS=$1
    if [ $SECONDS -lt 60 ]; then
        printf "%ds" "$SECONDS"
    else
        local MINUTES=$((SECONDS / 60))
        local REMAINDER=$((SECONDS % 60))
        printf "%dm %02ds" "$MINUTES" "$REMAINDER"
    fi
}

echo "=========================================="
echo "  Test and Run - Convert & Execute"
echo "=========================================="
echo ""

# Check if files are provided
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No Playwright spec files provided.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen-and-test -- <file1.spec.ts> [file2.spec.ts ...]"
    echo ""
    echo "Examples:"
    echo "  npm run codegen-and-test -- tests/actions/thread.spec.ts"
    echo "  npm run codegen-and-test -- tests/actions/thread.spec.ts tests/actions/dashboard.spec.ts"
    exit 1
fi

# Collect spec files
for ARG in "$@"; do
    # Skip if it's a flag
    if [[ "$ARG" == --* ]]; then
        continue
    fi
    
    # Check if file exists
    if [ -f "$AUTOMATION_DIR/$ARG" ]; then
        SPEC_FILES+=("$ARG")
    elif [ -f "$ARG" ]; then
        SPEC_FILES+=("$ARG")
    else
        echo -e "${RED}✗ File not found: $ARG${NC}"
        FAILED_FILES+=("$ARG")
    fi
done

if [ ${#SPEC_FILES[@]} -eq 0 ]; then
    echo -e "${RED}Error: No valid spec files found.${NC}"
    exit 1
fi

echo -e "${CYAN}Processing ${#SPEC_FILES[@]} file(s)...${NC}"
echo ""

# Run testid analysis by default (no prompt)
# echo -e "${CYAN}Do you want to analyze and add data-testid attributes to dashboard components? (y/n)${NC}"
# read -r RUN_TESTID < /dev/tty
RUN_TESTID="y"

if [ "$RUN_TESTID" = "y" ] || [ "$RUN_TESTID" = "Y" ]; then

# Step 1: Add data-testid attributes to dashboard components (LLM-based)
echo ""
echo "=========================================="
echo "  Step 1: Adding data-testid (LLM-based)"
echo "=========================================="
echo ""

# Detect dashboard source directory
DASHBOARD_SRC=""
if [ -d "$AUTOMATION_DIR/../../dashboard/src" ]; then
    DASHBOARD_SRC="$(cd "$AUTOMATION_DIR/../../dashboard/src" && pwd)"
elif [ -d "$AUTOMATION_DIR/../dashboard/src" ]; then
    DASHBOARD_SRC="$(cd "$AUTOMATION_DIR/../dashboard/src" && pwd)"
fi

if [ -z "$DASHBOARD_SRC" ]; then
    echo -e "${YELLOW}⚠ Dashboard src directory not found. Skipping testid addition.${NC}"
    echo -e "${YELLOW}  Searched: $AUTOMATION_DIR/../../dashboard/src and $AUTOMATION_DIR/../dashboard/src${NC}"
    echo ""
else
    echo -e "${CYAN}Dashboard source: $DASHBOARD_SRC${NC}"
    echo ""
    
    for SPEC_FILE in "${SPEC_FILES[@]}"; do
        BASE_NAME=$(basename "$SPEC_FILE" .spec.ts)
        echo -e "${CYAN}Analyzing: $SPEC_FILE${NC}"
        
        STEP_START_TIME=$(date +%s)
        
        # Resolve spec file path
        SPEC_PATH=""
        if [ -f "$AUTOMATION_DIR/$SPEC_FILE" ]; then
            SPEC_PATH="$AUTOMATION_DIR/$SPEC_FILE"
        elif [ -f "$SPEC_FILE" ]; then
            SPEC_PATH="$SPEC_FILE"
        fi

        if [ -z "$SPEC_PATH" ]; then
            echo -e "${YELLOW}⚠ Could not resolve spec file: $SPEC_FILE${NC}"
            continue
        fi

        # Run LLM-based testid addition directly
        set +e
        bash "$SCRIPT_DIR/add-testid-llm.sh" "$SPEC_PATH" "$DASHBOARD_SRC" < /dev/tty
        EXIT_CODE=$?
        set -e
        
        STEP_END_TIME=$(date +%s)
        STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
        STEP_DURATION_FMT=$(format_time $STEP_DURATION)
        
        if [ $EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}✓ TestID analysis complete: $SPEC_FILE (${STEP_DURATION_FMT})${NC}"
        else
            echo -e "${RED}✗ TestID analysis failed: $SPEC_FILE (exit code: $EXIT_CODE) (${STEP_DURATION_FMT})${NC}"
            echo -e "${RED}Aborting pipeline due to testid failure.${NC}"
            exit 1
        fi
        echo ""
    done
fi  # end of dashboard_src check

else  # user chose not to analyze
    echo ""
    echo -e "${YELLOW}Skipping data-testid analysis. Proceeding directly to conversion.${NC}"
    echo ""
fi  # end of RUN_TESTID check

# Step 2: Convert all spec files to BDD
echo "=========================================="
echo "  Step 2: Converting to BDD"
echo "=========================================="
echo ""

cd "$AUTOMATION_DIR"

for SPEC_FILE in "${SPEC_FILES[@]}"; do
    BASE_NAME=$(basename "$SPEC_FILE" .spec.ts)
    
    echo -e "${CYAN}Converting: $SPEC_FILE${NC}"
    STEP_START_TIME=$(date +%s)
    CONVERSION_LOG=$(mktemp)

    # Run test-automate directly — pipe tty so interactive prompts work
    set +e
    npm run codegen -- "$SPEC_FILE" < /dev/tty 2>&1 | tee "$CONVERSION_LOG"
    EXIT_CODE=${PIPESTATUS[0]}
    set -e

    STEP_END_TIME=$(date +%s)
    STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
    STEP_DURATION_FMT=$(format_time $STEP_DURATION)
    echo -e "${GREEN}✓ Conversion completed in ${STEP_DURATION_FMT}${NC}"

    # Show key lines from conversion log
    echo ""
    if [ -f "$CONVERSION_LOG" ]; then
        echo -e "${CYAN}  --- Conversion Log ---${NC}"
        grep -E '(✓|✗|⚠|WARNING|Found|feature file|Scenario|Testids|Skipping|coverage|Existing feature)' "$CONVERSION_LOG" 2>/dev/null | head -30 | while IFS= read -r logline; do
            if echo "$logline" | grep -qE '✗|Failed|Error'; then
                echo -e "  ${RED}${logline}${NC}"
            elif echo "$logline" | grep -qE '⚠|WARNING|Skipping'; then
                echo -e "  ${YELLOW}${logline}${NC}"
            elif echo "$logline" | grep -qE '✓|Successful|passed'; then
                echo -e "  ${GREEN}${logline}${NC}"
            else
                echo -e "  ${CYAN}${logline}${NC}"
            fi
        done
        KEY_LINE_COUNT=$(grep -cE '(✓|✗|⚠|WARNING|Found|feature file|Scenario|Testids|Skipping|coverage|Existing feature)' "$CONVERSION_LOG" 2>/dev/null || echo "0")
        if [ "$KEY_LINE_COUNT" -eq 0 ]; then
            echo -e "  ${YELLOW}(No key events found — showing last 30 lines of log)${NC}"
            tail -30 "$CONVERSION_LOG" | while IFS= read -r logline; do
                echo -e "  ${YELLOW}${logline}${NC}"
            done
        fi
        echo -e "${CYAN}  --- End Log ---${NC}"
        echo ""

        # Save full conversion log alongside LLM debug
        CONV_LOG_DIR="$AUTOMATION_DIR/llm_reports/conversion_logs"
        mkdir -p "$CONV_LOG_DIR"
        CONV_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        cp "$CONVERSION_LOG" "$CONV_LOG_DIR/${BASE_NAME}_conversion_${CONV_TIMESTAMP}.log"
        echo -e "${CYAN}  Full conversion log: $CONV_LOG_DIR/${BASE_NAME}_conversion_${CONV_TIMESTAMP}.log${NC}"
    fi
    rm -f "$CONVERSION_LOG"

    STEP_END_TIME=$(date +%s)
    STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
    STEP_DURATION_FMT=$(format_time $STEP_DURATION)

    # Only search for generated files after conversion is complete
    cd "$AUTOMATION_DIR"

    # ── Find generated files by base name ──
    E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"
    FEATURE_PATH=$(find "$E2E_DIR" -name "*${BASE_NAME}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)
    STEPS_PATH=$(find "$E2E_DIR" -name "*${BASE_NAME}*.steps.ts" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)

    echo -e "${CYAN}Looking for generated files matching: *${BASE_NAME}*${NC}"
    echo -e "  ${YELLOW}Feature:${NC} ${CYAN}${FEATURE_PATH:-<not found>}${NC}"
    echo -e "  ${YELLOW}Steps:${NC}   ${CYAN}${STEPS_PATH:-<not found>}${NC}"

    # Check feature file exists
    if [ -n "$FEATURE_PATH" ] && [ -f "$FEATURE_PATH" ]; then
        echo -e "${GREEN}✓ Feature file exists${NC}"
    else
        echo -e "${RED}✗ Feature file not found for: ${BASE_NAME}${NC}"
        FAILED_FILES+=("$SPEC_FILE")
        continue
    fi

    # Check steps file exists
    if [ -n "$STEPS_PATH" ] && [ -f "$STEPS_PATH" ]; then
        echo -e "${GREEN}✓ Steps file exists${NC}"
    else
        echo -e "${RED}✗ Steps file not found for: ${BASE_NAME}${NC}"
        FAILED_FILES+=("$SPEC_FILE")
        continue
    fi

    FEATURE_FILE="$FEATURE_PATH"
    STEPS_FILE="$STEPS_PATH"

    echo -e "${GREEN}✓ Converted: $SPEC_FILE${NC} (${STEP_DURATION_FMT})"
    echo -e "  ${YELLOW}Feature:${NC} ${CYAN}$FEATURE_FILE${NC}"
    echo -e "  ${YELLOW}Steps:${NC}   ${CYAN}$STEPS_FILE${NC}"
    SUCCESSFUL_FILES+=("$SPEC_FILE")
    echo ""
done

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
    echo -e "${RED}✗ ${#FAILED_FILES[@]} file(s) failed to convert${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All files converted successfully${NC}"
echo ""

# Step 2: Validate generated files
echo "=========================================="
echo "  Step 3: Validating Generated Files"
echo "=========================================="
echo ""

VALIDATION_FAILED=()
GENERATED_FEATURES=()

for SPEC_FILE in "${SUCCESSFUL_FILES[@]}"; do
    BASE_NAME=$(basename "$SPEC_FILE" .spec.ts)
    E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"

    # Find feature and steps files by base name
    FEATURE_FILE=$(find "$E2E_DIR" -name "*${BASE_NAME}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)
    STEPS_FILE=$(find "$E2E_DIR" -name "*${BASE_NAME}*.steps.ts" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)

    if [ -z "$FEATURE_FILE" ] || [ ! -f "$FEATURE_FILE" ] || [ -z "$STEPS_FILE" ] || [ ! -f "$STEPS_FILE" ]; then
        echo -e "${RED}✗ Feature or steps file not found for: $SPEC_FILE${NC}"
        echo -e "  ${YELLOW}Feature:${NC} ${CYAN}${FEATURE_FILE:-<not found>}${NC}"
        echo -e "  ${YELLOW}Steps:${NC}   ${CYAN}${STEPS_FILE:-<not found>}${NC}"
        VALIDATION_FAILED+=("$SPEC_FILE")
        continue
    fi
    
    echo -e "${CYAN}Validating: $(basename "$FEATURE_FILE")${NC}"
    
    # Sub-validation with retry
    RETRY_ATTEMPT=0
    MAX_RETRIES=2
    STEP_START_TIME=$(date +%s)
    PREVIOUS_DRY_RUN_REPORT=""
    
    while [ $RETRY_ATTEMPT -le $MAX_RETRIES ]; do
        if [ $RETRY_ATTEMPT -gt 0 ]; then
            echo -e "${YELLOW}  Retry attempt $RETRY_ATTEMPT of $MAX_RETRIES for $SPEC_FILE${NC}"
            
            # Backup previous failed files before retry
            if [ -n "$FEATURE_FILE" ] && [ -f "$FEATURE_FILE" ]; then
                FEATURE_FOLDER=$(dirname "$FEATURE_FILE")
                PREVIOUS_DIR="$FEATURE_FOLDER/_previous"
                mkdir -p "$PREVIOUS_DIR"
                
                # Move feature file with attempt suffix and .txt extension
                FEATURE_BASENAME=$(basename "$FEATURE_FILE" .feature)
                BACKUP_PATH="$PREVIOUS_DIR/${FEATURE_BASENAME}_attempt_$(printf "%02d" $((RETRY_ATTEMPT - 1))).feature.txt"
                mv "$FEATURE_FILE" "$BACKUP_PATH"
                echo -e "  ${YELLOW}Backed up previous feature:${NC} ${CYAN}$BACKUP_PATH${NC}"
            fi
            
            if [ -n "$STEPS_FILE" ] && [ -f "$STEPS_FILE" ]; then
                STEPS_FOLDER=$(dirname "$STEPS_FILE")
                PREVIOUS_DIR="$STEPS_FOLDER/_previous"
                mkdir -p "$PREVIOUS_DIR"
                
                # Move steps file with attempt suffix and .txt extension
                STEPS_BASENAME=$(basename "$STEPS_FILE" .steps.ts)
                BACKUP_PATH="$PREVIOUS_DIR/${STEPS_BASENAME}_attempt_$(printf "%02d" $((RETRY_ATTEMPT - 1))).steps.ts.txt"
                mv "$STEPS_FILE" "$BACKUP_PATH"
                echo -e "  ${YELLOW}Backed up previous steps:${NC} ${CYAN}$BACKUP_PATH${NC}"
            fi
            
            # If we have a previous failure report, include it in the retry
            if [ -n "$PREVIOUS_DRY_RUN_REPORT" ] && [ -f "$PREVIOUS_DRY_RUN_REPORT" ]; then
                echo -e "${YELLOW}  Sending previous failure report to LLM for correction...${NC}"
                echo -e "  ${YELLOW}Failure report:${NC} ${CYAN}$PREVIOUS_DRY_RUN_REPORT${NC}"
                set +e
                npm run codegen -- --dry-run-report "$PREVIOUS_DRY_RUN_REPORT" "$SPEC_FILE" 2>&1 | tee /dev/null
                set -e
            else
                set +e
                npm run codegen -- "$SPEC_FILE" 2>&1 | tee /dev/null
                set -e
            fi
            
            # Find the generated files dynamically after retry
            FEATURE_FILE=$(find "$AUTOMATION_DIR/tests/03_e2e" -name "*${BASE_NAME}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -n 1)
            STEPS_FILE=$(find "$AUTOMATION_DIR/tests/03_e2e" -name "*${BASE_NAME}*.steps.ts" -not -path "*/_previous/*" -type f 2>/dev/null | head -n 1)
            echo -e "  ${YELLOW}Feature:${NC} ${CYAN}${FEATURE_FILE:-<not found>}${NC}"
            echo -e "  ${YELLOW}Steps:${NC}   ${CYAN}${STEPS_FILE:-<not found>}${NC}"
        fi
        
        # Check files exist
        if [ ! -f "$FEATURE_FILE" ]; then
            echo -e "${RED}  ✗ Feature file missing${NC}"
            RETRY_ATTEMPT=$((RETRY_ATTEMPT + 1))
            continue
        fi
        
        if [ ! -f "$STEPS_FILE" ]; then
            echo -e "${RED}  ✗ Steps file missing${NC}"
            RETRY_ATTEMPT=$((RETRY_ATTEMPT + 1))
            continue
        fi
        
        # TypeScript check
        # if ! npx tsc --noEmit "$STEPS_FILE" 2>&1 | grep -q "error TS"; then
        #     echo -e "${GREEN}  ✓ TypeScript check passed${NC}"
        # else
        #     echo -e "${RED}  ✗ TypeScript errors found${NC}"
        #     RETRY_ATTEMPT=2
        #     continue
        # fi
        
        # Dry run check - run for all Cucumber tests
        echo -e "${CYAN}  Running dry run for all Cucumber tests...${NC}"
        
        DRY_RUN_OUTPUT_FILE=$(mktemp)
        set +e
        cd "$AUTOMATION_DIR"

        # Capture command for logging
        DRY_RUN_CMD_LOG="npm run test:e2e -- --dry-run"

        # Print command to terminal
        echo -e "${CYAN}  Command: $DRY_RUN_CMD_LOG${NC}"

        npm run test:e2e -- --dry-run \
            > "$DRY_RUN_OUTPUT_FILE" 2>&1
        DRY_RUN_EXIT_CODE=$?
        set -e

        # Check for cucumber undefined steps (summary line pattern only, not TS error messages)
        UNDEFINED_COUNT=$(grep -oE '[0-9]+ undefined' "$DRY_RUN_OUTPUT_FILE" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)
        UNDEFINED_COUNT=${UNDEFINED_COUNT:-0}
        # Check for TypeScript compilation errors
        TS_ERROR_COUNT=$(grep -cE ': error TS[0-9]+:' "$DRY_RUN_OUTPUT_FILE" 2>/dev/null | tail -1)
        TS_ERROR_COUNT=${TS_ERROR_COUNT:-0}
        # Check for ambiguous/duplicate step definitions
        AMBIGUOUS_COUNT=$(grep -oE '[0-9]+ ambiguous' "$DRY_RUN_OUTPUT_FILE" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)
        AMBIGUOUS_COUNT=${AMBIGUOUS_COUNT:-0}

        if [ "$UNDEFINED_COUNT" -gt 0 ] || [ "$TS_ERROR_COUNT" -gt 0 ] || [ "$AMBIGUOUS_COUNT" -gt 0 ] || [ $DRY_RUN_EXIT_CODE -ne 0 ]; then
            echo -e "${RED}  ✗ Dry run failed${NC}"
            if [ "$TS_ERROR_COUNT" -gt 0 ]; then
                echo -e "${RED}    TypeScript compilation errors: $TS_ERROR_COUNT${NC}"
            fi
            if [ "$UNDEFINED_COUNT" -gt 0 ]; then
                echo -e "${RED}    Undefined steps: $UNDEFINED_COUNT${NC}"
            fi
            if [ "$AMBIGUOUS_COUNT" -gt 0 ]; then
                echo -e "${RED}    Ambiguous (duplicate) step definitions: $AMBIGUOUS_COUNT${NC}"
                echo -e "${YELLOW}    The generated steps file likely re-defines steps that already exist in shared step files.${NC}"
            fi
            
            # Save failed dry run report to llm_reports/dry_run/
            DRY_RUN_DIR="$AUTOMATION_DIR/llm_reports/dry_run"
            mkdir -p "$DRY_RUN_DIR"
            DRY_RUN_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            FAILED_DRY_RUN_FILE="$DRY_RUN_DIR/${BASE_NAME}_failed_dry_run_${DRY_RUN_TIMESTAMP}.txt"
            {
                echo "=========================================="
                echo "FAILED DRY RUN REPORT"
                echo "=========================================="
                echo "Spec File: $SPEC_FILE"
                echo "Feature File: $FEATURE_FILE"
                echo "Steps File: $STEPS_FILE"
                echo "Time: $(date)"
                echo ""
                echo "=========================================="
                echo "COMMAND RAN:"
                echo "=========================================="
                echo "$DRY_RUN_CMD_LOG"
                echo ""
                echo "=========================================="
                echo "DRY RUN OUTPUT:"
                echo "=========================================="
                cat "$DRY_RUN_OUTPUT_FILE"
            } > "$FAILED_DRY_RUN_FILE"
            rm -f "$DRY_RUN_OUTPUT_FILE"

            
            echo -e "${YELLOW}    Details: $FAILED_DRY_RUN_FILE${NC}"
            echo -e "    ${YELLOW}Report path:${NC} ${CYAN}$FAILED_DRY_RUN_FILE${NC}"
            
            # Store the failed report for the next retry attempt
            PREVIOUS_DRY_RUN_REPORT="$FAILED_DRY_RUN_FILE"            # Increment retry counter and continue
            RETRY_ATTEMPT=$((RETRY_ATTEMPT + 1))
            continue
        else
            echo -e "${GREEN}  ✓ Dry run passed${NC}"
            rm -f "$DRY_RUN_OUTPUT_FILE"
        fi
        
        # All validations passed
        GENERATED_FEATURES+=("$FEATURE_FILE")
        
        # Extract tags from feature file
        FEATURE_TAGS=$(grep "^@" "$FEATURE_FILE" | head -n 1 | tr '\n' ' ')
        if [ -n "$FEATURE_TAGS" ]; then
            echo -e "${GREEN}  ✓ Found tags: $FEATURE_TAGS${NC}"
            # Add to tags to run (excluding @setup as it's always included)
            for tag in $FEATURE_TAGS; do
                if [[ "$tag" != "@setup" ]]; then
                    TAGS_TO_RUN="$TAGS_TO_RUN or $tag"
                fi
            done
        fi
        
        echo -e "${GREEN}✓ Validated: $(basename "$FEATURE_FILE")${NC}"
        break
    done
    STEP_END_TIME=$(date +%s)
    STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
    STEP_DURATION_FMT=$(format_time $STEP_DURATION)
    echo -e "${CYAN}Validation time for $SPEC_FILE: ${STEP_DURATION_FMT}${NC}"
    
    if [ $RETRY_ATTEMPT -gt $MAX_RETRIES ]; then
        echo -e "${RED}✗ Validation failed after $MAX_RETRIES retries: $SPEC_FILE${NC}"
        VALIDATION_FAILED+=("$SPEC_FILE")
    fi
    
    echo ""
done

if [ ${#VALIDATION_FAILED[@]} -gt 0 ]; then
    echo -e "${RED}✗ ${#VALIDATION_FAILED[@]} file(s) failed validation${NC}"
    echo ""
    echo "Please manually fix the following spec files:"
    for FILE in "${VALIDATION_FAILED[@]}"; do
        echo -e "${RED}  - $FILE${NC}"
    done
    echo ""
    echo -e "${YELLOW}Reports saved to: $AUTOMATION_DIR/llm_reports/${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All files validated successfully${NC}"
echo ""

# Step 3: Run Cucumber tests
echo "=========================================="
echo "  Step 4: Running Cucumber Tests"
echo "=========================================="
echo ""
echo -e "${CYAN}Running tests for generated feature file...${NC}"
cd "$AUTOMATION_DIR"

# Only run Cucumber if we have valid feature+steps file pairs
if [ ${#GENERATED_FEATURES[@]} -eq 0 ]; then
    echo -e "${RED}No valid feature+steps file pairs found. Skipping Cucumber run.${NC}"
    exit 1
fi

# Commented out tag-based runs:
# # Run @setup scenarios first if present in generated features
# SETUP_FEATURES=()
# for f in "${GENERATED_FEATURES[@]}"; do
#     if grep -q "^@setup" "$f"; then
#         SETUP_FEATURES+=("$f")
#     fi
# done
# if [ ${#SETUP_FEATURES[@]} -gt 0 ]; then
#     echo -e "${CYAN}Running @setup scenarios first...${NC}"
#     STEP_START_TIME=$(date +%s)
#     (npx cucumber-js --tags "@setup" "${SETUP_FEATURES[@]}") &
#     PID=$!
#     print_live_time $STEP_START_TIME "Running @setup scenarios" $PID
#     wait $PID
#     STEP_END_TIME=$(date +%s)
#     STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
#     STEP_DURATION_FMT=$(format_time $STEP_DURATION)
#     if [ $? -eq 0 ]; then
#         echo -e "${GREEN}  ✓ @setup scenarios completed (${STEP_DURATION_FMT})${NC}"
#     else
#         echo -e "${RED}  ✗ @setup scenarios failed (${STEP_DURATION_FMT})${NC}"
#         exit 1
#     fi
#     echo ""
# fi

# # Now run the generated features, excluding @setup
# STEP_START_TIME=$(date +%s)
# (npx cucumber-js --tags "not @setup" "${GENERATED_FEATURES[@]}") &
# PID=$!
# print_live_time $STEP_START_TIME "Running Cucumber tests" $PID
# wait $PID
# STEP_END_TIME=$(date +%s)
# STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
# STEP_DURATION_FMT=$(format_time $STEP_DURATION)
# if [ $? -eq 0 ]; then
#     echo ""
#     echo -e "${GREEN}=========================================="
#     echo -e "  ✓ All steps completed successfully! (${STEP_DURATION_FMT} for tests)"
#     echo -e "==========================================${NC}"
# else
#     echo ""
#     echo -e "${RED}=========================================="
#     echo -e "  ✗ Tests failed (${STEP_DURATION_FMT} for tests)"
#     echo -e "==========================================${NC}"
#     exit 1
# fi

# Instead, run the entire test suite
STEP_START_TIME=$(date +%s)
set +e
npm run test:e2e 2>&1
TEST_EXIT=$?
set -e
STEP_END_TIME=$(date +%s)
STEP_DURATION=$((STEP_END_TIME - STEP_START_TIME))
STEP_DURATION_FMT=$(format_time $STEP_DURATION)
if [ $TEST_EXIT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}=========================================="
    echo -e "  ✓ All steps completed successfully! (${STEP_DURATION_FMT} for tests)"
    echo -e "==========================================${NC}"
else
    echo ""
    echo -e "${RED}=========================================="
    echo -e "  ✗ Tests failed (${STEP_DURATION_FMT} for tests)"
    echo -e "==========================================${NC}"
    exit 1
fi

# After all steps, cleanup any lingering background processes
pkill -P $$ 2>/dev/null || true

SCRIPT_END_TIME=$(date +%s)
TOTAL_DURATION=$((SCRIPT_END_TIME - SCRIPT_START_TIME))
TOTAL_DURATION_FMT=$(format_time $TOTAL_DURATION)
echo -e "${CYAN}Total elapsed time: ${TOTAL_DURATION_FMT}${NC}"

exit 0