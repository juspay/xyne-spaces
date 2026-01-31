#!/bin/bash

# Directory containing the test files
TEST_DIR="tests/functional"

# Find all test spec files in the directory
TEST_FILES=$(find "$TEST_DIR" -name "*.spec.ts")

# Check if any test files were found
if [ -z "$TEST_FILES" ]; then
  echo "No test files found in $TEST_DIR"
  exit 1
fi

# Loop through each test file
for file in $TEST_FILES; do
  echo "Starting test: $file"
  
  # Command to be executed in the new terminal tab
  # This changes to the project directory, then runs a single test file with Playwright
  COMMAND_TO_RUN="cd $PWD && npx playwright test $file --project=chromium; exit"
  
  # AppleScript to open a new tab and run the command
  osascript -e "tell application \"Terminal\" to do script \"$COMMAND_TO_RUN\""
  
  echo "Waiting for 40 seconds before starting the next test..."
  sleep 40
done

echo "All tests have been started in separate tabs."
