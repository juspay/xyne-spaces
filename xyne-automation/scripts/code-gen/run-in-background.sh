#!/bin/bash

# Background Runner — Keeps codegen/test scripts running even when laptop is locked
# Usage:
#   ./run-in-background.sh codegen -- test-1.spec.ts
#   ./run-in-background.sh codegen-and-test -- test-1.spec.ts
#   ./run-in-background.sh <any-npm-script> -- [args...]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ $# -eq 0 ]; then
    echo -e "${RED}Usage: $0 <npm-script> -- [args...]${NC}"
    echo ""
    echo "Examples:"
    echo "  $0 codegen -- test-1.spec.ts"
    echo "  $0 codegen-and-test -- tests/actions/thread.spec.ts"
    echo ""
    echo "The script will:"
    echo "  1. Prevent macOS from sleeping (caffeinate)"
    echo "  2. Run the command with nohup so it survives terminal close"
    echo "  3. Log all output to llm_reports/background_runs/"
    exit 1
fi

NPM_SCRIPT="$1"
shift

# Create log directory
LOG_DIR="$AUTOMATION_DIR/llm_reports/background_runs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/${NPM_SCRIPT}_${TIMESTAMP}.log"
PID_FILE="$LOG_DIR/${NPM_SCRIPT}_${TIMESTAMP}.pid"

echo -e "${CYAN}=========================================="
echo -e "  Background Runner"
echo -e "==========================================${NC}"
echo ""
echo -e "${CYAN}Script:${NC}  npm run ${NPM_SCRIPT} $*"
echo -e "${CYAN}Log:${NC}     ${LOG_FILE}"
echo -e "${CYAN}PID file:${NC} ${PID_FILE}"
echo ""

cd "$AUTOMATION_DIR"

# Start caffeinate to prevent system sleep (will be killed when the script ends)
caffeinate -dims &
CAFFEINATE_PID=$!
echo -e "${GREEN}✓ caffeinate started (PID: ${CAFFEINATE_PID}) — system will not sleep${NC}"

# Write header to log
{
    echo "=========================================="
    echo "  Background Run: npm run ${NPM_SCRIPT} $*"
    echo "  Started: $(date)"
    echo "  Working Dir: $AUTOMATION_DIR"
    echo "=========================================="
    echo ""
} > "$LOG_FILE"

# Run the actual command with nohup, redirect all output to log
nohup npm run "${NPM_SCRIPT}" "$@" >> "$LOG_FILE" 2>&1 &
SCRIPT_PID=$!

# Save PIDs for later cleanup
echo "${SCRIPT_PID}" > "$PID_FILE"
echo "${CAFFEINATE_PID}" >> "$PID_FILE"

echo -e "${GREEN}✓ Process started in background (PID: ${SCRIPT_PID})${NC}"
echo ""
echo -e "${YELLOW}Commands:${NC}"
echo -e "  ${CYAN}Follow logs:${NC}     tail -f ${LOG_FILE}"
echo -e "  ${CYAN}Check status:${NC}    ps -p ${SCRIPT_PID}"
echo -e "  ${CYAN}Stop it:${NC}         kill ${SCRIPT_PID} && kill ${CAFFEINATE_PID}"
echo ""

# Set up a background watcher that kills caffeinate when the script finishes
(
    # Wait for the npm script to finish
    wait "$SCRIPT_PID" 2>/dev/null
    EXIT_CODE=$?

    # Kill caffeinate
    kill "$CAFFEINATE_PID" 2>/dev/null || true

    # Append result to log
    {
        echo ""
        echo "=========================================="
        echo "  Finished: $(date)"
        echo "  Exit Code: ${EXIT_CODE}"
        echo "=========================================="
    } >> "$LOG_FILE"

    # Cleanup PID file
    rm -f "$PID_FILE"
) &

echo -e "${GREEN}✓ You can now lock your laptop or close the terminal.${NC}"
echo -e "${GREEN}  The process will continue running.${NC}"
echo ""
echo -e "${CYAN}Tailing log (Ctrl+C to detach — process keeps running):${NC}"
echo ""

# Tail the log so user can see output; Ctrl+C detaches but process continues
tail -f "$LOG_FILE"
