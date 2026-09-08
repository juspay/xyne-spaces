#!/bin/sh
# Generate sample bundles under ./.bundles and load them into fake-gcs-server
# and MinIO for the local compose setup.
set -eu
cd "$(dirname "$0")"
HOST="${FAKE_GCS_HOST:-localhost:4443}"
BUCKET="${STORAGE_BUCKET:-xyne-frontend-bundles}"
OUT=.bundles

rm -rf "$OUT"
bundle() { # bundle <prefix> <label>
  d="$OUT/$1"
  mkdir -p "$d/assets" "$d/chunks"
  printf '<!doctype html><title>%s</title><script type=module src=/assets/app.%s.js></script><h1>%s</h1>\n' "$2" "$2" "$2" > "$d/index.html"
  printf "console.log('%s')\n" "$2" > "$d/assets/app.$2.js"
  printf 'h1{color:red}\n' > "$d/assets/style.$2.css"
  printf '{"bundle":"%s"}\n' "$1" > "$d/version.json"
  printf "self.addEventListener('fetch',()=>{})\n" > "$d/sw.js"
  printf 'export default 1\n' > "$d/chunks/lazy.$2.mjs"
}
# Lane names as the Jenkins pipeline writes them (flat, no commit hashes);
# the second argument is only a label baked into the sample files.
bundle main aaa111
bundle release-20260101 bbb222
bundle main-sdlc ccc333
bundle devqa-xyne-feature-x featurex

# --- fake-gcs -------------------------------------------------------------
until curl -sf "http://${HOST}/storage/v1/b" >/dev/null; do sleep 1; done
curl -s -X POST "http://${HOST}/storage/v1/b?project=local" \
  -H "Content-Type: application/json" -d "{\"name\":\"${BUCKET}\"}" >/dev/null || true
find "$OUT" -type f | while read -r f; do
  object="${f#$OUT/}"
  encoded=$(printf '%s' "$object" | sed 's#/#%2F#g')
  curl -s -X POST "http://${HOST}/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encoded}" \
    -H "Content-Type: application/octet-stream" --data-binary "@$f" >/dev/null
done
echo "seeded fake-gcs: $(find "$OUT" -type f | wc -l | tr -d ' ') objects"

# --- minio ------------------------------------------------------------------
docker compose --profile seed run --rm mc
