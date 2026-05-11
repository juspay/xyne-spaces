#!/bin/bash
# Cleanup ALL orphaned test containers, networks, and volumes

echo "🧹 Cleaning up all test resources..."

# Stop and remove ALL test containers
echo "Stopping test containers..."
docker ps -a --format "{{.Names}}" | grep "xyne-test-" | xargs -r docker rm -f

# Remove test networks
echo "Removing test networks..."
docker network ls --format "{{.Name}}" | grep "xyne-test-" | xargs -r docker network rm

# Remove test volumes
echo "Removing test volumes..."
docker volume ls --format "{{.Name}}" | grep "xyne-test-" | xargs -r docker volume rm

echo "✅ Cleanup complete!"
