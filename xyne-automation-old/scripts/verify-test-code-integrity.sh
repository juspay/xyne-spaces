#!/bin/bash
set -e

# Script to verify xyne-automation folder matches main branch
# Exits with code 1 if hashes don't match, 0 if they match

# Parse arguments
VERBOSE=false
for arg in "$@"; do
    case $arg in
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Symbols
CHECK_MARK='✓'
CROSS_MARK='✗'

cd "$(git rev-parse --show-toplevel)"

# Calculate hash on current branch
CURRENT_BRANCH_HASH=$(git ls-files -s xyne-automation/tests/ | awk '{print $2, $4}' | sort | sha256sum | awk '{print $1}')

# Calculate hash of xyne-automation folder in main branch
git fetch origin main --depth=1 2>/dev/null || true
MAIN_BRANCH_HASH=$(git ls-tree -r origin/main xyne-automation/tests/ | awk '{print $3, $4}' | sort | sha256sum | awk '{print $1}')

# Show hash details only in verbose mode
if [ "$VERBOSE" = true ]; then
    echo -e "${GRAY}Current branch test hash : ${YELLOW}${CURRENT_BRANCH_HASH}${NC}"
    echo -e "${GRAY}Main branch test hash    : ${YELLOW}${MAIN_BRANCH_HASH}${NC}"
    echo ""
fi

if [ "${CURRENT_BRANCH_HASH}" != "${MAIN_BRANCH_HASH}" ]; then
    echo -e "${RED}${CROSS_MARK} Test code is out of sync with main${NC}"
    echo ""
    echo "To fix this, run one of the following commands:"
    echo ""
    echo "  Rebase: git rebase origin/main"
    echo "  Merge:  git merge origin/main"
    echo ""
    echo -e " ${GRAY} - Or resolve it as you like${NC}"
    exit 1
else
    echo -e "${GREEN}${CHECK_MARK} Test code is in sync with main${NC}"
    exit 0
fi
