#!/bin/bash

# Seed fake-gcs with the folders needed to test PER-USER bundle serving locally:
#   - default/   (the fallback bundle everyone gets)
#   - beta-v2/   (an example override folder to map a user to)
#
# Both are seeded from the SAME built dashboard dist so you can eyeball which one
# is served. To tell them apart in the browser, this tags each folder's
# index.html with a visible marker comment and a distinct window.__BUNDLE_TAG__.
#
# Prereq: `pnpm run services` is up (fake-gcs running) and apps/dashboard/dist
# exists (build with `pnpm --filter xyne-spaces-dashboard run build`).
#
# Usage: bash scripts/setup-fake-gcs-per-user-bundle.sh

set -e

FAKE_GCS_HOST="localhost:4443"
BUNDLE_BUCKET="xyne-frontend-bundles"
DIST="apps/dashboard/dist"

echo "🚀 Seeding per-user bundle folders into fake-gcs..."

until curl -s "http://${FAKE_GCS_HOST}/storage/v1/b" > /dev/null 2>&1; do
  echo "   Waiting for fake-gcs-server..."
  sleep 2
done

# Ensure bucket exists (no-op if already created by setup-fake-gcs.sh)
curl -s -X POST "http://${FAKE_GCS_HOST}/storage/v1/b?project=xyne-spaces" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${BUNDLE_BUCKET}\"}" > /dev/null 2>&1 || true

if [ ! -d "${DIST}" ]; then
  echo "❌ ${DIST} not found. Build first: pnpm --filter xyne-spaces-dashboard run build"
  exit 1
fi

upload_folder() {
  local folder="$1"   # e.g. default or beta-v2
  local tag="$2"      # visible marker
  echo "📤 Uploading folder: ${folder}/ (tag=${tag})"

  local tmp
  tmp="$(mktemp -d)"
  cp -a "${DIST}/." "${tmp}/"

  # Tag index.html so it's obvious in-browser which folder served the page.
  if [ -f "${tmp}/index.html" ]; then
    printf '\n<!-- XYNE_BUNDLE_TAG:%s -->\n<script>window.__BUNDLE_TAG__=%s;</script>\n' \
      "${tag}" "\"${tag}\"" >> "${tmp}/index.html"
  fi

  ( cd "${tmp}"
    find . -type f | while read -r file; do
      file_path="${file#./}"
      encoded_path=$(printf '%s' "${folder}/${file_path}" | sed 's/ /%20/g')
      curl -s -X POST \
        "http://${FAKE_GCS_HOST}/upload/storage/v1/b/${BUNDLE_BUCKET}/o?uploadType=media&name=${encoded_path}" \
        --data-binary "@${file}" \
        -H "Content-Type: application/octet-stream" > /dev/null 2>&1 \
        || echo "   ⚠️  failed: ${file_path}"
    done
  )
  rm -rf "${tmp}"
  echo "   ✅ ${folder}/ uploaded"
}

upload_folder "default" "default"
upload_folder "beta-v2" "beta-v2"

echo ""
echo "✅ Done. Folders in gs://${BUNDLE_BUCKET}: default/, beta-v2/"
echo ""
echo "🧪 Test the serving path (backend on :3001):"
echo "   curl -s http://localhost:3001/api/bundles/me/index.html | grep XYNE_BUNDLE_TAG   # -> default (no override / not logged in)"
echo "   curl -s http://localhost:3001/api/bundles/beta-v2/index.html | grep XYNE_BUNDLE_TAG  # -> beta-v2 (explicit folder)"
echo ""
echo "🧪 Map a user to beta-v2 (needs a workspace admin JWT + a userId in that workspace):"
echo "   curl -X POST http://localhost:3001/api/bundles/admin/overrides \\"
echo "     -H 'Content-Type: application/json' -H 'Authorization: Bearer <admin-jwt>' \\"
echo "     -d '{\"userId\":\"<user-id>\",\"bundleName\":\"beta-v2\"}'"
echo "   # then, as THAT user:  curl -s http://localhost:3001/api/bundles/me/index.html | grep XYNE_BUNDLE_TAG  -> beta-v2"
