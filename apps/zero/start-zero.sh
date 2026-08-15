#!/bin/sh
set -e

# Start zero-cache in background
echo "Starting zero-cache..."
zero-cache &

# Wait a moment for zero-cache to start
sleep 2

# Start nginx in foreground (this keeps container running)
echo "Starting nginx..."
exec nginx -g "daemon off;"
