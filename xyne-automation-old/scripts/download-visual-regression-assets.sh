#!/bin/bash
#
# Download visual regression screenshots from GCS for regression testing
# Usage: ./download-visual-regression.sh [destination_dir]
#

# Configuration
GCS_BUCKET="${GCS_BUCKET:-xyne_spaces}"
GCS_PATH="gs://${GCS_BUCKET}/visual-regression-assets"
DEFAULT_DEST_DIR="xyne-automation/visual-regression-assets"
DEST_DIR="${1:-$DEFAULT_DEST_DIR}"

echo "=== Downloading Visual Regression Assets from GCS ==="
echo "Source: ${GCS_PATH}"
echo "Destination: ${DEST_DIR}"
echo ""

# Create destination directory
mkdir -p "${DEST_DIR}"

# Check if GCS path exists
if ! gsutil ls "${GCS_PATH}" >/dev/null 2>&1; then
  echo "⚠ WARNING: GCS path ${GCS_PATH} does not exist or is not accessible."
  echo "Skipping download."
  exit 1
fi

echo "Downloading assets..."
if gsutil -m cp -r "${GCS_PATH}/*" "${DEST_DIR}/" 2>&1; then
  echo "✓ Successfully downloaded assets to ${DEST_DIR}"

  echo "Looking for xyne-automation container..."
  CONTAINER_ID=$(docker compose -f docker-compose.dev.yml -f docker-compose.test.yml ps -q xyne-automation)

  if [ -n "$CONTAINER_ID" ]; then
    echo "Copying baselines to container $CONTAINER_ID..."
    docker exec $CONTAINER_ID mkdir -p /app/data/visual-regression-assets
    if docker cp ${DEST_DIR}/. $CONTAINER_ID:/app/data/visual-regression-assets/; then
       echo "✓ Successfully copied assets to container"
    else
       echo "✗ Failed to copy assets to container"
       exit 1
    fi
  else
    echo "ERROR: Could not find xyne-automation container to copy assets to"
    exit 1
  fi
else
  echo "✗ Failed to download assets"
  echo "Proceeding without baseline assets."
fi

echo ""
