#!/bin/bash

# Codegen Dispatcher — single entry point for all codegen commands
# Usage: npm run codegen -- <command> [options] [files...]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

show_help() {
    echo "=========================================="
    echo "  Xyne Codegen — Command Reference"
    echo "=========================================="
    echo ""
    echo -e "${CYAN}Usage:${NC} npm run codegen -- <command> [options] [files...]"
    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo ""
    echo -e "  ${CYAN}convert${NC}              Full pipeline: analyze → testids → convert → dry-run → test"
    echo -e "  ${CYAN}convert:skip-folder${NC}  Skip folder analysis (auto-pick folder by spec name)"
    echo -e "  ${CYAN}convert:skip-scenario${NC} Skip scenario duplicate analysis (always regenerate)"
    echo -e "  ${CYAN}convert:skip-all${NC}     Skip analysis + testids (conversion only)"
    echo -e "  ${CYAN}convert:skip-testids${NC} Skip testid addition step"
    echo -e "  ${CYAN}convert:skip-everything${NC} Skip all LLM analyses + testid addition (only conversion LLM runs)"
    echo -e "  ${CYAN}analyze${NC}               Run folder + scenario analysis in a single LLM call (no conversion)"
    echo -e "  ${CYAN}folder-analysis${NC}      Run folder placement analysis only (no conversion)"
    echo -e "  ${CYAN}scenario-analysis${NC}    Run scenario coverage analysis only (no conversion)"
    echo -e "  ${CYAN}add-testids${NC}          Add data-testid attrs to dashboard + update spec selectors"
    echo -e "  ${CYAN}cleanup${NC}              Clean up generated files"
    echo -e "  ${CYAN}help${NC}                 Show this help"
    echo ""
    echo -e "${GREEN}Examples:${NC}"
    echo ""
    echo "  npm run codegen -- convert test-1.spec.ts"
    echo "  npm run codegen -- convert:skip-all test-1.spec.ts"
    echo "  npm run codegen -- convert --dry-run-report report.txt test-1.spec.ts"
    echo "  npm run codegen -- convert --retry-folder 04_messages test-1.spec.ts"
    echo "  npm run codegen -- analyze tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- analyze 04_messages tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- folder-analysis tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- scenario-analysis 04_messages tests/actions/test-1.spec.ts"
    echo "  npm run codegen -- add-testids tests/actions/test-1.spec.ts ../dashboard/src"
    echo "  npm run codegen -- cleanup"
    echo ""
    echo -e "${GREEN}Options (for convert commands):${NC}"
    echo ""
    echo "  --dry-run-report <file>    Use dry-run failure report to fix previous attempt"
    echo "  --retry-folder <folder>    Specify folder explicitly for retry"
    echo ""
    echo -e "${GREEN}Skip flags (can be combined with convert):${NC}"
    echo ""
    echo "  npm run codegen -- convert:skip-all tests/actions/test-1.spec.ts          # skip testid + folder + scenario analysis"
    echo "  npm run codegen -- convert:skip-testids tests/actions/test-1.spec.ts      # skip testid addition"
    echo ""
}

# If no args, show help
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

COMMAND="$1"
shift

case "$COMMAND" in
    convert)
        exec bash "$SCRIPT_DIR/test-and-run.sh" "$@"
        ;;
    convert:skip-folder)
        exec "$SCRIPT_DIR/test-and-run.sh" --skip-folder-analysis "$@"
        ;;
    convert:skip-scenario)
        exec "$SCRIPT_DIR/test-and-run.sh" --skip-scenario-analysis "$@"
        ;;
    convert:skip-all)
        exec bash "$SCRIPT_DIR/test-and-run.sh" --skip-testids --skip-analysis "$@"
        ;;
    convert:skip-testids)
        exec bash "$SCRIPT_DIR/test-and-run.sh" --skip-testids "$@"
        ;;
    convert:skip-everything)
        exec bash "$SCRIPT_DIR/test-and-run.sh" --skip-all-analysis --skip-testids "$@"
        ;;
    folder-analysis)
        exec bash "$SCRIPT_DIR/folder-analysis.sh" "$@"
        ;;
    scenario-analysis)
        exec bash "$SCRIPT_DIR/scenario-analysis.sh" "$@"
        ;;
    analyze|analysis)
        exec bash "$SCRIPT_DIR/combined-analysis.sh" "$@"
        ;;
    add-testids)
        exec bash "$SCRIPT_DIR/add-testid-llm.sh" "$@"
        ;;
    cleanup)
        exec "$SCRIPT_DIR/cleanup.sh" "$@"
        ;;
    help|--help|-h)
        show_help
        exit 0
        ;;
    *)
        # Backward compat: if command looks like a .spec.ts file, assume "convert"
        if [[ "$COMMAND" == *.spec.ts ]]; then
            exec "$SCRIPT_DIR/test-and-run.sh" "$COMMAND" "$@"
        fi
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac