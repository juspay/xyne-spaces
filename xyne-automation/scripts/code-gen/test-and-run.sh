#!/bin/bash

# Test and Run — full pipeline: testids → analyze → convert → dry-run → retry → test
# Usage: ./test-and-run.sh [flags] <spec-files...>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
DASHBOARD_SRC="$AUTOMATION_DIR/../dashboard/src"

# Ensure Ctrl+C exits the entire pipeline
trap 'echo -e "\n\033[0;31m✗ Pipeline interrupted by user (Ctrl+C)\033[0m"; exit 130' INT TERM

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "=========================================="
echo "  Test and Run - Full Pipeline"
echo "=========================================="
echo ""

# Parse flags and spec files
CODEGEN_FLAGS=()
SKIP_TESTIDS=false
SKIP_ANALYSIS=false
SKIP_CONVERT=false
RETRY_FOLDER=""
SPEC_FILES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-testids)
            SKIP_TESTIDS=true
            shift
            ;;
        --skip-analysis)
            SKIP_ANALYSIS=true
            shift
            ;;
        --skip-convert)
            SKIP_CONVERT=true
            shift
            ;;
        --skip-folder-analysis|--skip-scenario-analysis|--skip-all-analysis)
            CODEGEN_FLAGS+=("$1")
            SKIP_ANALYSIS=true
            shift
            ;;
        --retry-folder)
            RETRY_FOLDER="$2"
            CODEGEN_FLAGS+=("$1" "$2")
            shift 2
            ;;
        --dry-run-report)
            CODEGEN_FLAGS+=("$1" "$2")
            shift 2
            ;;
        *)
            SPEC_FILES+=("$1")
            shift
            ;;
    esac
done

if [ ${#SPEC_FILES[@]} -eq 0 ]; then
    echo -e "${RED}Error: No spec files provided.${NC}"
    echo ""
    echo "Usage:"
    echo "  npm run codegen -- convert <spec-files...>"
    echo ""
    echo "Flags:"
    echo "  --skip-testids        Skip data-testid addition step"
    echo "  --skip-analysis       Skip folder+scenario analysis step"
    echo "  --skip-all-analysis   Skip all analysis LLM calls"
    echo "  --skip-convert        Skip conversion (only run dry-run)"
    echo "  --retry-folder <f>    Use specific folder (skip folder selection)"
    echo ""
    exit 1
fi

# Resolve spec file paths
RESOLVED_SPECS=()
for spec in "${SPEC_FILES[@]}"; do
    if [ -f "$spec" ]; then
        RESOLVED_SPECS+=("$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")")
    elif [ -f "$AUTOMATION_DIR/tests/actions/$spec" ]; then
        RESOLVED_SPECS+=("$AUTOMATION_DIR/tests/actions/$spec")
    elif [ -f "$AUTOMATION_DIR/$spec" ]; then
        RESOLVED_SPECS+=("$AUTOMATION_DIR/$spec")
    else
        echo -e "${RED}✗ File not found: $spec${NC}"
    fi
done

if [ ${#RESOLVED_SPECS[@]} -eq 0 ]; then
    echo -e "${RED}No valid spec files found.${NC}"
    exit 1
fi

# Build the original spec args for recovery commands
SPEC_ARGS=""
for s in "${SPEC_FILES[@]}"; do
    SPEC_ARGS="$SPEC_ARGS $s"
done
SPEC_ARGS=$(echo "$SPEC_ARGS" | sed 's/^ //')

echo -e "${CYAN}Processing ${#RESOLVED_SPECS[@]} file(s)...${NC}"
echo ""

# ============================================================
# Step 1: Add data-testid attributes (unless skipped)
# ============================================================
if [ "$SKIP_TESTIDS" = true ]; then
    echo -e "${YELLOW}⏭ Skipping testid addition (--skip-testids)${NC}"
    echo ""
else
    echo "=========================================="
    echo "  Step 1: Adding data-testid (LLM-based)"
    echo "=========================================="
    echo ""

    if [ -d "$DASHBOARD_SRC" ]; then
        for spec in "${RESOLVED_SPECS[@]}"; do
            echo -e "${CYAN}Adding testids for: $(basename "$spec")${NC}"
            set +e
            bash "$SCRIPT_DIR/add-testid-llm.sh" "$spec" "$DASHBOARD_SRC"
            TESTID_EXIT=$?
            set -e
            if [ $TESTID_EXIT -eq 130 ]; then
                echo -e "${RED}✗ Interrupted by user.${NC}"
                exit 130
            fi
            if [ $TESTID_EXIT -ne 0 ]; then
                echo -e "${RED}✗ Testid addition failed for $(basename "$spec")${NC}"
                echo ""
                echo -e "${YELLOW}💡 Recovery options:${NC}"
                echo -e "  ${CYAN}Skip testids and continue:${NC}"
                echo -e "  ${GREEN}npm run codegen -- convert --skip-testids $SPEC_ARGS${NC}"
                echo ""
            fi
            echo ""
        done
    else
        echo -e "${YELLOW}⚠ Dashboard source not found at $DASHBOARD_SRC${NC}"
        echo -e "${YELLOW}  Skipping testid addition automatically.${NC}"
        echo ""
    fi
fi

# ============================================================
# Step 2: Combined Analysis (folder + scenario) — calls combined-analysis.sh
# ============================================================
if [ "$SKIP_ANALYSIS" = true ]; then
    echo -e "${YELLOW}⏭ Skipping analysis (--skip-analysis)${NC}"
    echo ""
else
    echo "=========================================="
    echo "  Step 2: Analysis (folder + scenario)"
    echo "=========================================="
    echo ""

    for spec in "${RESOLVED_SPECS[@]}"; do
        # Skip if folder already provided
        if [ -n "$RETRY_FOLDER" ]; then
            echo -e "${YELLOW}Using provided folder: ${RETRY_FOLDER}${NC}"
            break
        fi

        echo -e "${CYAN}Analyzing: $(basename "$spec")${NC}"

        # Create temp file for combined-analysis.sh to write the selected folder
        ANALYSIS_OUTPUT=$(mktemp)

        set +e
        ANALYSIS_OUTPUT_FILE="$ANALYSIS_OUTPUT" bash "$SCRIPT_DIR/combined-analysis.sh" "$spec"
        ANALYSIS_EXIT=$?
        set -e

        if [ $ANALYSIS_EXIT -eq 130 ]; then
            echo -e "${RED}✗ Interrupted by user.${NC}"
            rm -f "$ANALYSIS_OUTPUT"
            exit 130
        fi

        if [ $ANALYSIS_EXIT -ne 0 ]; then
            echo -e "${RED}✗ Analysis failed for $(basename "$spec")${NC}"
            echo ""
            echo -e "${YELLOW}💡 Recovery options:${NC}"
            echo -e "  ${CYAN}Skip analysis and specify folder manually:${NC}"
            echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder 06_canvas $SPEC_ARGS${NC}"
            echo ""
            rm -f "$ANALYSIS_OUTPUT"
            echo -e "${RED}Stopping pipeline.${NC}"
            exit 1
        fi

        # Read the selected folder from analysis output
        if [ -f "$ANALYSIS_OUTPUT" ] && [ -s "$ANALYSIS_OUTPUT" ]; then
            RETRY_FOLDER=$(cat "$ANALYSIS_OUTPUT")
            CODEGEN_FLAGS+=("--retry-folder" "$RETRY_FOLDER")
            echo ""
            echo -e "${GREEN}✓ Analysis selected folder: ${RETRY_FOLDER}${NC}"
        else
            echo -e "${YELLOW}⚠ No folder selected from analysis (user may have chosen skip).${NC}"
            rm -f "$ANALYSIS_OUTPUT"
            echo -e "${CYAN}Exiting pipeline. To convert manually:${NC}"
            echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder <folder> $SPEC_ARGS${NC}"
            exit 0
        fi

        rm -f "$ANALYSIS_OUTPUT"
        echo ""
    done
fi

# ============================================================
# Step 3: Convert spec to feature+steps
# ============================================================
if [ "$SKIP_CONVERT" = true ]; then
    echo -e "${YELLOW}⏭ Skipping conversion (--skip-convert)${NC}"
    echo ""
else
    echo "=========================================="
    echo "  Step 3: Converting to Cucumber"
    echo "=========================================="
    echo ""

    for spec in "${RESOLVED_SPECS[@]}"; do
        echo -e "${CYAN}Converting: $(basename "$spec")${NC}"
        set +e
        bash "$SCRIPT_DIR/test-automate.sh" --skip-all-analysis "${CODEGEN_FLAGS[@]}" "$spec"
        CONVERT_EXIT=$?
        set -e

        if [ $CONVERT_EXIT -eq 130 ]; then
            echo -e "${RED}✗ Interrupted by user.${NC}"
            exit 130
        fi

        if [ $CONVERT_EXIT -ne 0 ]; then
            echo -e "${RED}✗ Conversion failed for $(basename "$spec")${NC}"
            echo ""
            echo -e "${YELLOW}💡 Recovery options:${NC}"
            echo -e "  ${CYAN}Retry conversion only (skip analysis + testids):${NC}"
            if [ -n "$RETRY_FOLDER" ]; then
                echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder $RETRY_FOLDER $SPEC_ARGS${NC}"
            else
                echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis $SPEC_ARGS${NC}"
            fi
            echo ""
        fi
        echo ""
    done
fi

# ============================================================
# Step 4: Dry-run the generated feature files
# ============================================================
echo "=========================================="
echo "  Step 4: Dry-run validation"
echo "=========================================="
echo ""

E2E_DIR="$AUTOMATION_DIR/tests/03_e2e"

for spec in "${RESOLVED_SPECS[@]}"; do
    BASE_NAME=$(basename "$spec" .spec.ts)

    # Find the generated feature file
    FEATURE_FILE=$(find "$E2E_DIR" -name "*${BASE_NAME}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)

    if [ -z "$FEATURE_FILE" ]; then
        echo -e "${YELLOW}⚠ No feature file found for ${BASE_NAME}, skipping dry-run${NC}"
        continue
    fi

    FEATURE_REL=$(realpath --relative-to="$AUTOMATION_DIR" "$FEATURE_FILE" 2>/dev/null || echo "$FEATURE_FILE")
    echo -e "${CYAN}Feature: $FEATURE_REL${NC}"

    DRY_RUN_REPORT="$AUTOMATION_DIR/llm_reports/dry_run/${BASE_NAME}_dryrun_$(date +%Y%m%d_%H%M%S).txt"
    mkdir -p "$(dirname "$DRY_RUN_REPORT")"

    set +e
    cd "$AUTOMATION_DIR"
    npx cucumber-js --dry-run "$FEATURE_FILE" --profile e2e > "$DRY_RUN_REPORT" 2>&1
    DRY_RUN_EXIT=$?
    set -e

    if [ $DRY_RUN_EXIT -eq 0 ]; then
        echo -e "${GREEN}✓ Dry-run passed!${NC}"
    else
        echo -e "${RED}✗ Dry-run failed (exit code: $DRY_RUN_EXIT)${NC}"
        echo -e "${YELLOW}Report: $DRY_RUN_REPORT${NC}"
        echo ""

        # Detect folder from feature path
        DETECTED_FOLDER=$(echo "$FEATURE_FILE" | sed -E "s|.*/tests/03_e2e/([^/]+)/.*|\1|")

        # Find related steps file
        STEPS_FILE=$(find "$(dirname "$FEATURE_FILE")" -name "*.steps.ts" -type f 2>/dev/null | head -1)
        STEPS_REL=""
        if [ -n "$STEPS_FILE" ]; then
            STEPS_REL=$(realpath --relative-to="$AUTOMATION_DIR" "$STEPS_FILE" 2>/dev/null || echo "$STEPS_FILE")
        fi

        # ── Analyze the dry-run report to detect failure type ──
        DRY_RUN_CONTENT=$(cat "$DRY_RUN_REPORT" 2>/dev/null)
        HAS_UNDEFINED=false
        HAS_AMBIGUOUS=false
        HAS_PARSE_ERROR=false
        HAS_IMPORT_ERROR=false
        UNDEFINED_STEPS=()

        if echo "$DRY_RUN_CONTENT" | grep -qiE '(undefined|pending).*step'; then
            HAS_UNDEFINED=true
        fi
        if echo "$DRY_RUN_CONTENT" | grep -qiE 'Undefined'; then
            HAS_UNDEFINED=true
        fi
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            UNDEFINED_STEPS+=("$line")
        done <<< "$(echo "$DRY_RUN_CONTENT" | grep -oE '(Given|When|Then|And|But) .*' | grep -v '^$' | head -20)"

        if echo "$DRY_RUN_CONTENT" | grep -qiE 'ambiguous'; then
            HAS_AMBIGUOUS=true
        fi
        if echo "$DRY_RUN_CONTENT" | grep -qiE '(parse error|syntax error|SyntaxError|unexpected token)'; then
            HAS_PARSE_ERROR=true
        fi
        if echo "$DRY_RUN_CONTENT" | grep -qiE '(Cannot find module|import error|ModuleNotFoundError|ERR_MODULE_NOT_FOUND)'; then
            HAS_IMPORT_ERROR=true
        fi

        # ── Show diagnosis ──
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}🔍 Dry-run failure diagnosis:${NC}"
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        if [ "$HAS_UNDEFINED" = true ]; then
            echo -e "${RED}  ❌ Undefined steps detected${NC}"
            if [ ${#UNDEFINED_STEPS[@]} -gt 0 ]; then
                echo -e "${CYAN}  Missing step definitions:${NC}"
                for us in "${UNDEFINED_STEPS[@]}"; do
                    echo -e "    ${YELLOW}• $us${NC}"
                done
            fi
            echo ""
            echo -e "${GREEN}  🔧 Fix: Re-generate steps file only${NC}"
            echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder $DETECTED_FOLDER --dry-run-report $DRY_RUN_REPORT $SPEC_ARGS${NC}"
            if [ -n "$STEPS_REL" ]; then
                echo -e "  ${CYAN}Or manually add missing steps to:${NC} ${GREEN}$STEPS_REL${NC}"
            fi
        fi

        if [ "$HAS_AMBIGUOUS" = true ]; then
            echo -e "${RED}  ⚠️  Ambiguous step definitions detected${NC}"
            echo -e "  ${CYAN}Check for duplicate patterns in:${NC}"
            if [ -n "$STEPS_REL" ]; then
                echo -e "  ${GREEN}$STEPS_REL${NC}"
            fi
            echo -e "  ${GREEN}tests/shared/common.steps.ts${NC}"
            echo -e "  ${GREEN}tests/shared/browser.steps.ts${NC}"
            echo -e "  ${CYAN}Then re-run:${NC} ${GREEN}cd $AUTOMATION_DIR && npx cucumber-js --dry-run $FEATURE_REL --profile e2e${NC}"
        fi

        if [ "$HAS_PARSE_ERROR" = true ]; then
            echo -e "${RED}  ❌ Syntax/Parse error${NC}"
            echo -e "  ${CYAN}Re-generate both feature + steps:${NC}"
            echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder $DETECTED_FOLDER $SPEC_ARGS${NC}"
        fi

        if [ "$HAS_IMPORT_ERROR" = true ]; then
            echo -e "${RED}  ❌ Import/Module error${NC}"
            echo -e "  ${GREEN}npm install${NC}                    # Install missing packages"
            echo -e "  ${GREEN}npx tsc --noEmit${NC}               # Check TypeScript errors"
        fi

        if [ "$HAS_UNDEFINED" = false ] && [ "$HAS_AMBIGUOUS" = false ] && [ "$HAS_PARSE_ERROR" = false ] && [ "$HAS_IMPORT_ERROR" = false ]; then
            echo -e "${YELLOW}  ❓ Unknown failure:${NC}"
            tail -30 "$DRY_RUN_REPORT"
            echo ""
            echo -e "  ${GREEN}npm run codegen -- convert --skip-testids --skip-analysis --retry-folder $DETECTED_FOLDER --dry-run-report $DRY_RUN_REPORT $SPEC_ARGS${NC}"
        fi

        echo ""

        # ── Auto-retry for fixable errors (undefined steps, import errors, parse errors) ──
        if [ "$HAS_UNDEFINED" = true ] || [ "$HAS_IMPORT_ERROR" = true ] || [ "$HAS_PARSE_ERROR" = true ]; then
            RETRY_REASON=""
            if [ "$HAS_UNDEFINED" = true ]; then
                RETRY_REASON="undefined steps"
            elif [ "$HAS_IMPORT_ERROR" = true ]; then
                RETRY_REASON="import/module errors"
            elif [ "$HAS_PARSE_ERROR" = true ]; then
                RETRY_REASON="parse/syntax errors"
            fi
            echo -e "${YELLOW}🔄 Auto-retrying: fixing ${RETRY_REASON}...${NC}"
            echo ""

            set +e
            bash "$SCRIPT_DIR/test-automate.sh" --skip-all-analysis \
                --dry-run-report "$DRY_RUN_REPORT" \
                --retry-folder "$DETECTED_FOLDER" \
                "$spec"
            RETRY_EXIT=$?
            set -e

            if [ $RETRY_EXIT -eq 0 ]; then
                echo -e "${GREEN}✓ Retry succeeded! Re-running dry-run...${NC}"
                DRY_RUN_REPORT2="$AUTOMATION_DIR/llm_reports/dry_run/${BASE_NAME}_dryrun_retry_$(date +%Y%m%d_%H%M%S).txt"
                set +e
                cd "$AUTOMATION_DIR"
                npx cucumber-js --dry-run "$FEATURE_FILE" --profile e2e > "$DRY_RUN_REPORT2" 2>&1
                DRY_RUN_EXIT2=$?
                set -e

                if [ $DRY_RUN_EXIT2 -eq 0 ]; then
                    echo -e "${GREEN}✓ Dry-run passed after retry!${NC}"
                else
                    echo -e "${RED}✗ Dry-run still failing after retry${NC}"
                    echo -e "  ${CYAN}Report:${NC} ${GREEN}cat $DRY_RUN_REPORT2${NC}"
                    echo -e "  ${CYAN}Manual dry-run:${NC} ${GREEN}cd $AUTOMATION_DIR && npx cucumber-js --dry-run $FEATURE_REL --profile e2e${NC}"
                    echo ""
                    echo -e "${RED}Stopping pipeline — fix the issues above before running tests.${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}✗ Auto-retry failed${NC}"
                if [ -n "$STEPS_REL" ]; then
                    echo -e "  ${CYAN}Edit steps file:${NC} ${GREEN}$STEPS_REL${NC}"
                fi
                echo -e "  ${CYAN}Then dry-run:${NC} ${GREEN}cd $AUTOMATION_DIR && npx cucumber-js --dry-run $FEATURE_REL --profile e2e${NC}"
                echo ""
                echo -e "${RED}Stopping pipeline — fix the issues above before running tests.${NC}"
                exit 1
            fi
        fi
    fi
    echo ""
done

# ============================================================
# Step 5: Run the tests (only setup + generated feature tags)
# ============================================================
echo "=========================================="
echo "  Step 5: Running E2E tests"
echo "=========================================="
echo ""

cd "$AUTOMATION_DIR"

# Collect unique tags from generated feature files
GENERATED_TAGS=()
for spec in "${RESOLVED_SPECS[@]}"; do
    BASE_NAME=$(basename "$spec" .spec.ts)
    FEATURE_FILE=$(find "$E2E_DIR" -name "*${BASE_NAME}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)
    if [ -n "$FEATURE_FILE" ] && [ -f "$FEATURE_FILE" ]; then
        # Extract all tags from the feature file (excluding @e2e and @setup which are common)
        while IFS= read -r tag; do
            tag=$(echo "$tag" | tr -d '[:space:]')
            [ -z "$tag" ] && continue
            [[ "$tag" == "@e2e" ]] && continue
            [[ "$tag" == "@setup" ]] && continue
            # Avoid duplicates
            if [[ ! " ${GENERATED_TAGS[*]} " =~ " ${tag} " ]]; then
                GENERATED_TAGS+=("$tag")
            fi
        done <<< "$(grep -oE '@[a-zA-Z0-9_-]+' "$FEATURE_FILE" 2>/dev/null)"
    fi
done

if [ ${#GENERATED_TAGS[@]} -eq 0 ]; then
    echo -e "${YELLOW}⚠ No feature tags found — running full e2e suite${NC}"
    TAG_EXPR="@setup or @e2e"
else
    # Build tag expression: @setup or @tag1 or @tag2 ...
    TAG_EXPR="@setup"
    for tag in "${GENERATED_TAGS[@]}"; do
        TAG_EXPR="$TAG_EXPR or $tag"
    done
    echo -e "${CYAN}Running with tags: ${TAG_EXPR}${NC}"
fi

echo -e "${GREEN}Command: npx cucumber-js --tags \"${TAG_EXPR}\" --profile e2e${NC}"
echo ""

set +e
npx cucumber-js --tags "$TAG_EXPR" --profile e2e
TEST_EXIT=$?
set -e

if [ $TEST_EXIT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ All tests passed!${NC}"
else
    echo ""
    echo -e "${RED}✗ Tests failed (exit code: $TEST_EXIT)${NC}"
    echo ""
    echo -e "${YELLOW}💡 Recovery options:${NC}"
    echo -e "  ${CYAN}Re-run tests:${NC} ${GREEN}npm run test:e2e${NC}"
    for spec in "${RESOLVED_SPECS[@]}"; do
        BN=$(basename "$spec" .spec.ts)
        FF=$(find "$E2E_DIR" -name "*${BN}*.feature" -not -path "*/_previous/*" -type f 2>/dev/null | head -1)
        if [ -n "$FF" ]; then
            FF_REL=$(realpath --relative-to="$AUTOMATION_DIR" "$FF" 2>/dev/null || echo "$FF")
            echo -e "  ${CYAN}Run specific:${NC} ${GREEN}npx cucumber-js $FF_REL --profile e2e${NC}"
        fi
    done
    echo -e "  ${CYAN}Debug mode:${NC}  ${GREEN}npm run test:debug${NC}"
fi

echo ""
echo -e "${GREEN}Done!${NC}"