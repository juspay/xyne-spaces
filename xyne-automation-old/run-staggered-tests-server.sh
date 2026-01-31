#!/bin/bash

# This script runs all functional tests in parallel in a server-safe manner.
# It is designed for any environment, including headless Linux servers.
# It staggers the start of each test and runs them as background processes.

# Function to fetch repo version from API endpoint
fetch_repo_version() {
  # TODO: Add endpoint URL once ready
  # REPO_VERSION_ENDPOINT="https://your-api-endpoint.com/version"

  # For now, keep the endpoint empty and just return git commit hash
  # When endpoint is ready, uncomment the following:
  # if [ -n "$REPO_VERSION_ENDPOINT" ]; then
  #   REPO_VERSION=$(curl -s "$REPO_VERSION_ENDPOINT" | jq -r '.version' 2>/dev/null)
  #   if [ -n "$REPO_VERSION" ]; then
  #     echo "$REPO_VERSION"
  #     return 0
  #   fi
  # fi

  # Fallback to git commit hash
  if git rev-parse --git-dir > /dev/null 2>&1; then
    REPO_VERSION=$(git rev-parse --short HEAD 2>/dev/null)
    if [ -n "$REPO_VERSION" ]; then
      echo "$REPO_VERSION"
      return 0
    fi
  fi

  # If both methods fail, return empty string
  echo ""
  return 1
}

# Generate a single Cron Run ID for this entire batch
CRON_RUN_ID=$(date +"%Y%m%d%H%M%S")
export CRON_RUN_ID
export IS_CRON_RUN=true

# Fetch and export repo version
echo " Fetching repository version..."
REPO_VERSION=$(fetch_repo_version)
if [ -n "$REPO_VERSION" ]; then
  export REPO_VERSION
  echo " Repository version: $REPO_VERSION"
else
  echo "WARNING:  Could not determine repository version (will be stored as NULL in database)"
  export REPO_VERSION=""
fi

echo " Starting test batch with Cron Run ID: $CRON_RUN_ID"
echo " This ID will be shared across all tests in this batch"

# Set up environment for cron compatibility
# Try to source NVM if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

# If node/npm are not in PATH, try to find them
if ! command -v node &> /dev/null; then
    # Try to find node in common NVM locations
    if [ -f "$HOME/.nvm/versions/node/v22.20.0/bin/node" ]; then
        export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"
    elif [ -f "/usr/bin/node" ]; then
        export PATH="/usr/bin:$PATH"
    else
        echo "ERROR: Node.js not found. Please ensure Node.js is installed."
        exit 1
    fi
fi

# Verify Node.js and npm are available
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found in PATH. Current PATH: $PATH"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found in PATH. Current PATH: $PATH"
    exit 1
fi

echo "Using Node.js version: $(node --version)"
echo "Using npm version: $(npm --version)"

# ============================================
# DATABASE INITIALIZATION
# ============================================
# Initialize test_runs table entry with version tracking
echo ""
echo " Initializing test run in database..."

# Ensure consistent user for database operations
# Only use value from .env file
if [ -f .env ]; then
  SCRIPT_RUN_BY=$(grep "^SCRIPT_RUN_BY=" .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
  export SCRIPT_RUN_BY
else
  echo "WARNING:  Warning: .env file not found, SCRIPT_RUN_BY not set"
fi

npx tsx scripts/manage-test-run.ts init
echo ""

# ============================================
# ORCHESTRATOR-BASED PARALLEL STAGGERED EXECUTION
# ============================================
# Run all modules in PARALLEL with staggered start times
# Each module runs in its own background process (worker)
# Modules start with 50-second delays between them
# All modules use their own TestOrchestrator with continueOnFailure

echo "--------------------------------------------------"
echo " Running All Modules in Parallel with Staggered Start"
echo "Cron Run ID: $CRON_RUN_ID"
echo "--------------------------------------------------"

# Directory containing the test files (only Xyne tests, excluding Spaces)
TEST_DIR="tests/functional/xyne-spaces"

# Find all test spec files (excluding meta orchestrator files) and sort them
TEST_FILES=$(find "$TEST_DIR" -name "*.spec.ts" \
  ! -name "all-modules-orchestrated.spec.ts" \
  ! -name "all-modules-staggered.spec.ts" \
  | sort)

# Check if any test files were found
if [ -z "$TEST_FILES" ]; then
  echo "No test files found in $TEST_DIR"
  exit 1
fi

echo " Found test modules:"
for file in $TEST_FILES; do
  echo "   - $file"
done
echo "--------------------------------------------------"

# Create timestamp for unique file naming
TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S-%3NZ")

# Stagger delay in seconds (time between starting each module)
STAGGER_DELAY=50

# Array to store background process IDs
pids=()

# Counter for delay
delay_count=0

echo " Starting modules in parallel with ${STAGGER_DELAY}s stagger delay"
echo "--------------------------------------------------"

# Loop through each module and start with staggered delay
for file in $TEST_FILES; do
  MODULE=$(basename "$file" .spec.ts)
  export MODULE_NAME=$MODULE

  echo "  Scheduling module: $MODULE (starts in $((delay_count * STAGGER_DELAY))s)"

  # Create module-specific config
  TEMP_CONFIG="playwright.config.${MODULE}.${TIMESTAMP}.js"
  cat > "$TEMP_CONFIG" << EOF
import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.ts';

export default defineConfig({
  ...baseConfig,
  reporter: [
    ['./src/framework/core/orchestrator-reporter.ts'], // MUST be first to fix test statuses before other reporters
    ['blob', { outputDir: 'reports/blob-report-${MODULE}' }], // Capture ALL step details including clicks, fills, expects
    ['json', { outputFile: 'reports/test-results-${MODULE}-${TIMESTAMP}.json' }],
    ['junit', { outputFile: 'reports/junit-results-${MODULE}-${TIMESTAMP}.xml' }],
    ['list'],
    ['./src/framework/core/enhanced-reporter.ts']
  ],
  outputDir: 'reports/test-artifacts-${MODULE}-${TIMESTAMP}'
});
EOF

  # Start module in background with stagger delay
  # Each module runs as a separate worker (background process)
  (
    # Wait for stagger delay before starting this module
    if [ $delay_count -gt 0 ]; then
      sleep $((delay_count * STAGGER_DELAY))
    fi

    echo ""
    echo "--------------------------------------------------"
    echo " Starting module: $MODULE (Worker $((delay_count + 1)))"
    echo "--------------------------------------------------"

    # Run the module test
    npx playwright test "$file" --project=chromium --config="$TEMP_CONFIG"
    module_exit=$?

    echo ""
    echo "--------------------------------------------------"
    if [ $module_exit -eq 0 ]; then
      echo " Module $MODULE completed successfully"
    else
      echo "WARNING:  Module $MODULE had failures (orchestrator continued on failure)"
    fi
    echo "--------------------------------------------------"

    # Clean up config file after completion
    rm -f "$TEMP_CONFIG"

    exit $module_exit
  ) &

  # Store the background process ID
  pids+=($!)

  delay_count=$((delay_count + 1))
done

echo ""
echo "--------------------------------------------------"
echo " All $delay_count modules scheduled with staggered starts"
echo "  Total stagger time: $((delay_count * STAGGER_DELAY)) seconds"
echo " Worker PIDs: ${pids[*]}"
echo " Waiting for all modules to complete..."
echo "--------------------------------------------------"

# Wait for all background processes and collect exit codes
exit_code=0
completed=0
total=${#pids[@]}

for pid in "${pids[@]}"; do
  if wait "$pid"; then
    completed=$((completed + 1))
    echo " Worker $pid completed successfully ($completed/$total)"
  else
    completed=$((completed + 1))
    echo "WARNING:  Worker $pid had failures ($completed/$total)"
    exit_code=1
  fi
done

echo ""
echo "--------------------------------------------------"
echo " Batch $CRON_RUN_ID completed"
echo " Repository Version: ${REPO_VERSION:-'N/A'}"
echo " Modules completed: $total/$total"
if [ $exit_code -eq 0 ]; then
  echo " All modules completed successfully."
else
  echo "WARNING:  Some modules had failures (but all ran with orchestrator continueOnFailure)."
fi
echo " Check individual module reports and database for detailed results"
echo "--------------------------------------------------"

# ============================================
# UPDATE TEST RUN STATUS IN DATABASE
# ============================================
echo ""
echo " Updating test run status in database..."
npx tsx scripts/manage-test-run.ts complete "$exit_code"
echo ""

# Wait for database writes to complete before generating PDF
echo " Waiting for all test data to be written to database..."
echo " Allowing 30 seconds for database synchronization..."
sleep 30

# Verify data exists before generating PDF
echo " Verifying test data in database..."
npx tsx scripts/manage-test-run.ts verify "$CRON_RUN_ID"
verify_exit_code=$?

if [ $verify_exit_code -eq 0 ]; then
  echo " Test data verified in database"

  # Generate PDF report after all tests complete
  echo " Generating PDF summary report..."
  python3 src/framework/utils/pdf-report-generator.py "$CRON_RUN_ID"
  pdf_exit_code=$?

  if [ $pdf_exit_code -eq 0 ]; then
    echo " PDF report generated successfully"
  else
    echo "WARNING: PDF report generation failed (exit code: $pdf_exit_code)"
  fi
else
  echo "WARNING: Test data not found in database, skipping PDF generation"
  echo " This may indicate that database writes are still in progress or failed"
  pdf_exit_code=1
fi

echo "--------------------------------------------------"
echo " Test execution and reporting completed for batch: $CRON_RUN_ID"
echo "--------------------------------------------------"

exit $exit_code
