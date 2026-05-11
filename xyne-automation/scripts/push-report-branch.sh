#!/usr/bin/env bash

#==============================================================================
# Push Test Reports to Temporary Branch
#==============================================================================
#
# This script creates and pushes a temporary branch with test reports.
# It extracts the ticket ID from the last commit message, creates a temp branch,
# commits the reports, and pushes to origin.
#
# Usage: ./push-report-branch.sh
#
# The temp branch name follows the pattern: {current-branch}-test-reports
# Example: feature/my-fix -> feature/my-fix-test-reports
#
#==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

prompt_force_push() {
  local branch_type="$1"
  local branch_name="$2"

  echo -e "${YELLOW}⚠️  $branch_type branch '$branch_name' already exists.${NC}"
  echo -e "${YELLOW}   Do you want to force push? This will overwrite the existing branch.${NC}"
  echo ""
  read -p "Force push? (y/N): " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${RED}❌ Force push declined.${NC}"
    echo ""
    echo -e "${YELLOW}To proceed, clean up the existing branch and run again:${NC}"
    echo -e "${BLUE}   npm run test:push${NC}"
    echo ""
    if [ "$branch_type" = "Local" ]; then
      echo -e "${YELLOW}To delete local branch:${NC}"
      echo -e "${BLUE}   git branch -D $branch_name${NC}"
    elif [ "$branch_type" = "Remote" ]; then
      echo -e "${YELLOW}To delete remote branch:${NC}"
      echo -e "${BLUE}   git push origin --delete $branch_name${NC}"
    fi
    echo ""
    exit 1
  fi

  return 0
}

# Get repository root
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Get current branch name
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${BLUE}Current branch: $CURRENT_BRANCH${NC}"

# Extract ticket ID from the last commit message
LAST_COMMIT_MSG=$(git log -1 --format=%s)
TICKET_ID=$(echo "$LAST_COMMIT_MSG" | grep -oE '[A-Z]+-[0-9]+' | head -n 1)

if [ -z "$TICKET_ID" ]; then
  echo -e "${YELLOW}⚠️  No ticket ID found in commit message. Using 'NO-TICKET'.${NC}"
  TICKET_ID="NO-TICKET"
else
  echo -e "${GREEN}✓ Found ticket ID: $TICKET_ID${NC}"
fi

# Create temp branch name
TEMP_BRANCH="${CURRENT_BRANCH}-test-reports"
echo -e "${BLUE}Temp branch name: $TEMP_BRANCH${NC}"

# Find the target report directory (supports both npm run test and npm run test:runner)
REPORT_DIR="$REPO_ROOT/xyne-automation/reports"
COMMIT_HASH=$(git rev-parse --short=9 HEAD)

# If a custom report name is provided, use it, otherwise find the latest report for this commit
if [ -n "$CUSTOM_REPORT_NAME" ]; then
  LATEST_BUILD_DIR="$REPORT_DIR/$CUSTOM_REPORT_NAME"
else
  # Find the latest report directory matching this commit hash
  # Supports: {hash}-1, {hash}-2, {hash}-runner, etc.
  LATEST_BUILD_DIR=$(ls -d "$REPORT_DIR/${COMMIT_HASH}"-* 2>/dev/null | sort -V | tail -1)
fi

if [ -z "$LATEST_BUILD_DIR" ] || [ ! -d "$LATEST_BUILD_DIR" ]; then
  echo -e "${YELLOW}⚠️  No report for commit $COMMIT_HASH — running tests first.${NC}"
  echo ""

  if ! npm run test --prefix "$REPO_ROOT"; then
    echo ""
    echo -e "${RED}❌ Automation tests failed. Not pushing reports.${NC}"
    echo -e "${RED}   Fix the failures and run 'npm run test:push' again.${NC}"
    exit 1
  fi

  echo ""
  echo -e "${BLUE}Re-checking for report after test run...${NC}"
  LATEST_BUILD_DIR=$(ls -d "$REPORT_DIR/${COMMIT_HASH}"-* 2>/dev/null | sort -V | tail -1)

  if [ -z "$LATEST_BUILD_DIR" ] || [ ! -d "$LATEST_BUILD_DIR" ]; then
    echo -e "${RED}❌ Tests ran but no report directory was produced for commit $COMMIT_HASH.${NC}"
    echo -e "${RED}   Check the test runner output above for errors.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}✓ Report directory: $LATEST_BUILD_DIR${NC}"

# Check if there are any files to commit
if [ -z "$(ls -A "$LATEST_BUILD_DIR" 2>/dev/null)" ]; then
  echo -e "${RED}❌ No report files found in the directory. Skipping report push.${NC}"
  exit 1
fi

echo -e "${BLUE}Checking for existing branches...${NC}"

if git branch --list "$TEMP_BRANCH" | grep -q "$TEMP_BRANCH"; then
  prompt_force_push "Local" "$TEMP_BRANCH"
  echo -e "${YELLOW}Deleting local temp branch...${NC}"
  git branch -D "$TEMP_BRANCH"
fi

if git ls-remote --heads origin "$TEMP_BRANCH" 2>/dev/null | grep -q "$TEMP_BRANCH"; then
  prompt_force_push "Remote" "$TEMP_BRANCH"
fi

echo -e "${BLUE}Creating temp branch: $TEMP_BRANCH${NC}"
git checkout -b "$TEMP_BRANCH"

# Force add the report directory for current commit only (it's gitignored)
echo -e "${BLUE}Adding report for commit $COMMIT_HASH to temp branch...${NC}"
git add -f "$LATEST_BUILD_DIR"

# Check if there are staged changes
if git diff --cached --quiet; then
  echo -e "${YELLOW}⚠️  No changes to commit. Skipping report push.${NC}"
  git checkout "$CURRENT_BRANCH"
  git branch -D "$TEMP_BRANCH"
  exit 0
fi

# Create the commit
echo -e "${BLUE}Creating commit with test reports...${NC}"
HUSKY=0 git commit --no-verify -m "chore: $TICKET_ID added automation test reports"

echo -e "${GREEN}✓ Created commit with test reports${NC}"

# Push to origin with force (to overwrite any existing temp branch)
echo -e "${BLUE}Pushing temp branch to origin...${NC}"
if git push --force --no-verify origin "$TEMP_BRANCH"; then
  echo -e "${GREEN}✅ Successfully pushed test reports to origin/$TEMP_BRANCH${NC}"
else
  echo -e "${RED}❌ Failed to push temp branch to origin.${NC}"
  echo -e "${YELLOW}   You can retry manually with: git push --force origin $TEMP_BRANCH${NC}"
  git checkout "$CURRENT_BRANCH"
  # Keep the local temp branch for retry
  exit 1
fi

# Backup the report dir before checkout — git checkout would otherwise remove
# the (now-tracked-on-temp-branch) files because the original branch doesn't track them.
BACKUP_DIR=$(mktemp -d)
cp -r "$LATEST_BUILD_DIR" "$BACKUP_DIR/"

# Return to the original branch
echo -e "${BLUE}Returning to original branch: $CURRENT_BRANCH${NC}"
git checkout "$CURRENT_BRANCH"

# Delete local temp branch (remote remains for Jenkins)
echo -e "${BLUE}Cleaning up local temp branch...${NC}"
git branch -D "$TEMP_BRANCH"

# Restore the local report so the user keeps a copy on disk
mkdir -p "$(dirname "$LATEST_BUILD_DIR")"
cp -r "$BACKUP_DIR/$(basename "$LATEST_BUILD_DIR")" "$(dirname "$LATEST_BUILD_DIR")/"
rm -rf "$BACKUP_DIR"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Test Reports Pushed Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Branch: origin/$TEMP_BRANCH${NC}"
echo -e "${BLUE}Ticket: $TICKET_ID${NC}"
echo ""
echo -e "${YELLOW}ℹ️  Jenkins will now:${NC}"
echo -e "${YELLOW}   - Detect the temp branch${NC}"
echo -e "${YELLOW}   - Archive the test reports${NC}"
echo -e "${YELLOW}   - Process cucumber results${NC}"
echo -e "${YELLOW}   - Delete the temp branch${NC}"
echo ""
