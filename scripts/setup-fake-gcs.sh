#!/bin/bash

# Script to setup fake-gcs-server bucket and upload test bundles

set -e

FAKE_GCS_HOST="localhost:4443"
BUNDLE_BUCKET="xyne-frontend-bundles"
CHAT_BUCKET="xyne-spaces-chat-documents"
TEST_BRANCH="devqa-xyne-test-123"

echo "🚀 Setting up fake-gcs-server..."

# Wait for fake-gcs to be ready
echo "⏳ Waiting for fake-gcs-server to be ready..."
until curl -s http://${FAKE_GCS_HOST}/storage/v1/b > /dev/null 2>&1; do
  echo "   Waiting for fake-gcs-server..."
  sleep 2
done
echo "✅ fake-gcs-server is ready!"

# Create bundle bucket
echo "📦 Creating bucket: ${BUNDLE_BUCKET}"
curl -X POST "http://${FAKE_GCS_HOST}/storage/v1/b?project=xyne-spaces" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${BUNDLE_BUCKET}\"}" \
  2>/dev/null || echo "   Bucket may already exist, continuing..."

echo "✅ Bucket created/verified: ${BUNDLE_BUCKET}"

# Create chat documents bucket (for file uploads in chat)
echo "📦 Creating bucket: ${CHAT_BUCKET}"
curl -X POST "http://${FAKE_GCS_HOST}/storage/v1/b?project=xyne-spaces" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${CHAT_BUCKET}\"}" \
  2>/dev/null || echo "   Bucket may already exist, continuing..."

echo "✅ Bucket created/verified: ${CHAT_BUCKET}"

# Build dashboard if not already built
if [ ! -d "dashboard/dist" ]; then
  echo "🔨 Building dashboard..."
  cd dashboard
  npm run build
  cd ..
  echo "✅ Dashboard built!"
else
  echo "✅ Dashboard dist already exists"
fi

# Upload test bundle using curl (more reliable with fake-gcs-server)
echo "📤 Uploading test bundle to: ${TEST_BRANCH}/"

cd dashboard/dist
file_count=$(find . -type f | wc -l | tr -d ' ')
echo "   Found ${file_count} files to upload..."

current=0
find . -type f | while read file; do
  file_path="${file#./}"
  current=$((current + 1))
  echo "   [${current}/${file_count}] Uploading: ${file_path}"

  # URL encode the file path
  encoded_path=$(echo "${TEST_BRANCH}/${file_path}" | sed 's/ /%20/g')

  curl -s -X POST "http://${FAKE_GCS_HOST}/upload/storage/v1/b/${BUNDLE_BUCKET}/o?uploadType=media&name=${encoded_path}" \
    --data-binary "@${file}" \
    -H "Content-Type: application/octet-stream" \
    > /dev/null 2>&1

  if [ $? -ne 0 ]; then
    echo "   ⚠️  Failed to upload: ${file_path}"
  fi
done
cd ../..

echo "✅ Test bundle uploaded successfully!"
echo ""
echo "📋 Summary:"
echo "   Buckets created:"
echo "     - ${BUNDLE_BUCKET} (frontend bundles)"
echo "     - ${CHAT_BUCKET} (chat file uploads)"
echo "   Test branch: ${TEST_BRANCH}"
echo "   Endpoint: http://${FAKE_GCS_HOST}"
echo ""
echo "🧪 To test, set User-Agent header to: ${TEST_BRANCH}"
echo "   Example: curl -H 'User-Agent: ${TEST_BRANCH}' http://localhost:3000"
echo ""
