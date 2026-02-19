#!/bin/bash
set -e

# Script to verify xyne-automation folder matches main branch
# Exits with code 1 if hashes don't match, 0 if they match

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GRAY}Calculating hash on current branch test...${NC}"
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH_HASH=$(git ls-files -s xyne-automation/tests/ | awk '{print $2, $4}' | sort | sha256sum | awk '{print $1}')
echo -e "Current branch test hash : ${YELLOW}${CURRENT_BRANCH_HASH}${NC}"
echo ""

# Calculate hash of xyne-automation folder in main branch
git fetch origin main --depth=1 2>/dev/null || true

echo -e "${GRAY}Calculating hash of main branch test...${NC}"
MAIN_BRANCH_HASH=$(git ls-tree -r origin/main xyne-automation/tests/ | awk '{print $3, $4}' | sort | sha256sum | awk '{print $1}')
echo -e "Main branch test hash    : ${YELLOW}${MAIN_BRANCH_HASH}${NC}"
echo ""

if [ "${CURRENT_BRANCH_HASH}" != "${MAIN_BRANCH_HASH}" ]; then
    echo -e "${RED}ERROR: Hashes Mismatch${NC}"
    echo "Please ensure your test code is in sync with main."
    exit 1
else
    echo -e "${GREEN}SUCCESS: Hashes Matched ${NC}"
    exit 0
fi
