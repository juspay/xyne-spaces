#!/bin/bash
# Watch script for auto-rebuilding transcription-agent on file changes
# Usage: ./scripts/watch-transcription-agent.sh

set -e

WATCH_DIR="backend/python-agent"
COMPOSE_FILE="docker-compose.dev.yml"
SERVICE_NAME="transcription-agent"

echo "🔍 Watching $WATCH_DIR for changes..."
echo "📦 Will rebuild and restart $SERVICE_NAME on file changes"
echo "Press Ctrl+C to stop"
echo ""

# Initial build
echo "🚀 Starting initial build..."
podman-compose -f "$COMPOSE_FILE" up -d --build "$SERVICE_NAME"
echo "✅ Initial build complete. Watching for changes..."
echo ""

# Watch for changes and rebuild
fswatch -o "$WATCH_DIR" | while read -r; do
    echo ""
    echo "📝 Change detected in $WATCH_DIR"
    echo "🔄 Rebuilding $SERVICE_NAME..."
    
    # Rebuild and restart
    podman-compose -f "$COMPOSE_FILE" up -d --build "$SERVICE_NAME"
    
    echo "✅ Rebuild complete!"
    echo ""
    echo "📋 Recent logs:"
    podman logs "$SERVICE_NAME" --tail 20 2>/dev/null || podman logs "xyne-$SERVICE_NAME" --tail 20
    echo ""
    echo "🔍 Continuing to watch..."
done
