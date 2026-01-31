#!/bin/bash

# Script to set up cron job for run-staggered-tests-server.sh
# This script will add a cron job that runs 4 times daily at 00, 06, 12, and 18 hours

echo "Setting up cron job for automated test execution..."
echo "=============================================="

# Get the current directory (should be the project directory)
PROJECT_DIR=$(pwd)
SCRIPT_PATH="$PROJECT_DIR/run-staggered-tests-server.sh"
LOG_PATH="$PROJECT_DIR/cron-test-logs.log"

# Check if the test script exists
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "ERROR: run-staggered-tests-server.sh not found in current directory!"
    echo "Please run this script from the xyne-automation project directory."
    exit 1
fi

# Check if the script is executable
if [ ! -x "$SCRIPT_PATH" ]; then
    echo "Making run-staggered-tests-server.sh executable..."
    chmod +x "$SCRIPT_PATH"
fi

# Get the directory containing Node.js and npm (needed for cron environment)
NODE_DIR=$(dirname $(which node))
NVM_DIR="$HOME/.nvm"

# Create the cron job entry with proper environment setup
CRON_ENTRY="0 0,6,12,18 * * * export PATH=$NODE_DIR:\$PATH && export NVM_DIR=$NVM_DIR && cd $PROJECT_DIR && ./run-staggered-tests-server.sh >> $LOG_PATH 2>&1"

echo "Current cron jobs:"
crontab -l 2>/dev/null || echo "No existing cron jobs found."
echo ""

echo "Adding new cron job:"
echo "$CRON_ENTRY"
echo ""

# Add the cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

if [ $? -eq 0 ]; then
    echo " Cron job successfully added!"
    echo ""
    echo "Schedule: 4 times daily at 00:00, 06:00, 12:00, and 18:00"
    echo "Script: $SCRIPT_PATH"
    echo "Logs: $LOG_PATH"
    echo ""
    echo "To view current cron jobs: crontab -l"
    echo "To remove this cron job: crontab -e (then delete the line)"
    echo "To view logs: tail -f $LOG_PATH"
else
    echo " Failed to add cron job!"
    exit 1
fi

echo ""
echo "=============================================="
echo "Cron job setup complete!"
