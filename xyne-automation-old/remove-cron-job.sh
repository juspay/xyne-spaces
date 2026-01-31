#!/bin/bash

# Script to remove the cron job for run-staggered-tests-server.sh

echo "Removing cron job for automated test execution..."
echo "=============================================="

# Get the current directory (should be the project directory)
PROJECT_DIR=$(pwd)

echo "Current cron jobs:"
crontab -l 2>/dev/null || echo "No existing cron jobs found."
echo ""

# Remove the specific cron job entry
crontab -l 2>/dev/null | grep -v "run-staggered-tests-server.sh" | crontab -

if [ $? -eq 0 ]; then
    echo " Cron job successfully removed!"
    echo ""
    echo "Remaining cron jobs:"
    crontab -l 2>/dev/null || echo "No cron jobs remaining."
else
    echo " Failed to remove cron job!"
    exit 1
fi

echo ""
echo "=============================================="
echo "Cron job removal complete!"
