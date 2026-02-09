

set -e

FAKE_GCS_HOST="${FAKE_GCS_HOST:-fake-gcs:4443}"
BUNDLE_BUCKET="xyne-frontend-bundles"
CHAT_BUCKET="xyne-spaces-chat-documents"

echo "🚀 Setting up fake-gcs-server for test environment..."

# Wait for fake-gcs to be ready
echo "⏳ Waiting for fake-gcs-server to be ready..."
max_attempts=30
attempt=0
until curl -s http://${FAKE_GCS_HOST}/storage/v1/b > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo "❌ Timeout waiting for fake-gcs-server after ${max_attempts} attempts"
    exit 1
  fi
  echo "   Attempt ${attempt}/${max_attempts}: Waiting for fake-gcs-server..."
  sleep 2
done
echo "✅ fake-gcs-server is ready!"

# Create bundle bucket
echo "📦 Creating bucket: ${BUNDLE_BUCKET}"
curl -s -X POST "http://${FAKE_GCS_HOST}/storage/v1/b?project=xyne-spaces" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${BUNDLE_BUCKET}\"}" \
  2>/dev/null || true
echo "✅ Bucket created/verified: ${BUNDLE_BUCKET}"

# Create chat documents bucket
echo "📦 Creating bucket: ${CHAT_BUCKET}"
curl -s -X POST "http://${FAKE_GCS_HOST}/storage/v1/b?project=xyne-spaces" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${CHAT_BUCKET}\"}" \
  2>/dev/null || true
echo "✅ Bucket created/verified: ${CHAT_BUCKET}"

echo "✅ fake-gcs-server setup complete!"
