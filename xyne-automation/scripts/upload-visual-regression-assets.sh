#!/bin/bash
#
# Upload visual regression screenshots to GCS
# Usage: ./upload-visual-regression.sh <build_number> <branch> <commit> <commit_datetime> <triggered_by> <timestamp>
#

# Arguments
BUILD_NUMBER="${1:?BUILD_NUMBER is required}"
BRANCH="${2:?BRANCH is required}"
COMMIT="${3:?COMMIT is required}"
COMMIT_DATETIME="${4:?COMMIT_DATETIME is required}"
TRIGGERED_BY="${5:?TRIGGERED_BY is required}"
TIMESTAMP="${6:?TIMESTAMP is required}"

# Configuration - GCS bucket is configurable via environment variable
GCS_BUCKET="${GCS_BUCKET:-xyne_spaces}"
GCS_PATH="gs://${GCS_BUCKET}/visual-regression-assets"
REPORT_DIR="xyne-automation/report"
METADATA_FILE="${REPORT_DIR}/visual-regression-metadata.txt"

echo "=== Uploading Visual Regression Assets to GCS ==="
echo ""

# Find the report timestamp folder (there's only one folder inside report/)
REPORT_FOLDER=$(find "${REPORT_DIR}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)

# Validate report folder exists and is unique
FOLDER_COUNT=$(find "${REPORT_DIR}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
if [ "$FOLDER_COUNT" -gt 1 ]; then
  echo "⚠ WARNING: Multiple report folders found in ${REPORT_DIR}/, using first one"
fi

# Validate report folder exists
if [ -z "$REPORT_FOLDER" ]; then
  echo "⚠ WARNING: No report folder found in ${REPORT_DIR}/"
  echo "Skipping visual regression upload"
  exit 0
fi

echo "✓ Using report folder: $REPORT_FOLDER"
echo ""

# Upload visual regression screenshots (overwrites existing)
SCREENSHOTS_DIR="${REPORT_FOLDER}/visual-regression-screenshots"
if [ -d "${SCREENSHOTS_DIR}" ]; then
  SCREENSHOT_COUNT=$(find "${SCREENSHOTS_DIR}" -type f -name "*.png" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$SCREENSHOT_COUNT" -eq 0 ]; then
    echo "⚠ WARNING: No screenshots found in ${SCREENSHOTS_DIR}"
  else
    echo "Uploading ${SCREENSHOT_COUNT} screenshots..."

    if gsutil -m cp -r "${SCREENSHOTS_DIR}"/* "${GCS_PATH}/" 2>&1; then
      echo "✓ Successfully uploaded ${SCREENSHOT_COUNT} screenshots"
    else
      echo "✗ Failed to upload screenshots"
    fi
  fi
else
  echo "⚠ WARNING: No visual-regression-screenshots folder found in ${REPORT_FOLDER}"
fi

echo ""

# Create and upload metadata file with build info
cat > "${METADATA_FILE}" << EOF
Build Number    : ${BUILD_NUMBER}
Branch          : ${BRANCH}
Commit          : ${COMMIT}
Commit DateTime : ${COMMIT_DATETIME}
Triggered By    : ${TRIGGERED_BY}
Timestamp       : ${TIMESTAMP}
EOF

echo "Uploading metadata..."
if gsutil cp "${METADATA_FILE}" "${GCS_PATH}/metadata.txt" 2>/dev/null; then
  echo "✓ Metadata uploaded successfully"
else
  echo "✗ Failed to upload metadata"
fi

echo ""
echo "✓ Visual regression upload completed!"
echo "GCS Path: ${GCS_PATH}"
