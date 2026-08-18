#!/usr/bin/env bash
#
# Apply CORS to the transcription bucket so the WEB dashboard can upload
# offline-recorder repair chunks directly to GCS via signed PUT URLs.
#
# WHY: browsers enforce CORS on cross-origin PUTs. The signed upload URLs issued
# by the backend point at storage.googleapis.com, a different origin from the
# dashboard, so the bucket must allow PUT from the dashboard origins.
#
# NOTE: the Electron app uploads from its main process (not a browser context),
# so it is NOT subject to CORS and does not need this. This script only matters
# for the web dashboard.
#
# Run ONCE per environment. Requires storage.buckets.update on the bucket
# (do NOT grant this to the runtime service account — run this out-of-band as an
# operator). It is intentionally not applied at app boot.
#
# Usage:
#   BUCKET="<TRANSCRIPTION_BUCKET_NAME>" \
#   ORIGINS="https://app.example.com,http://localhost:5173" \
#     ./scripts/setup-gcs-recording-cors.sh
#
# BUCKET   defaults to $TRANSCRIPTION_BUCKET_NAME if set.
# ORIGINS  comma-separated; defaults to http://localhost:5173 (local dashboard).
#
# Local dev uses fake-gcs-server (see scripts/setup-fake-gcs.sh) which does not
# enforce CORS the same way; this script targets real GCS.
set -euo pipefail

BUCKET="${BUCKET:-${TRANSCRIPTION_BUCKET_NAME:-}}"
ORIGINS="${ORIGINS:-http://localhost:5173}"

if [[ -z "${BUCKET}" ]]; then
  echo "ERROR: set BUCKET (or TRANSCRIPTION_BUCKET_NAME) to the transcription bucket name." >&2
  exit 1
fi

# Build the origins JSON array from the comma-separated list.
origins_json="$(printf '%s' "${ORIGINS}" | awk -F',' '{
  out=""
  for (i = 1; i <= NF; i++) {
    gsub(/^[ \t]+|[ \t]+$/, "", $i)
    if ($i == "") continue
    if (out != "") out = out ", "
    out = out "\"" $i "\""
  }
  print out
}')"

cors_file="$(mktemp -t xyne-recording-cors.XXXXXX.json)"
trap 'rm -f "${cors_file}"' EXIT

cat > "${cors_file}" <<JSON
[
  {
    "origin": [${origins_json}],
    "method": ["PUT", "GET", "HEAD"],
    "responseHeader": ["Content-Type", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
JSON

echo "Applying CORS to gs://${BUCKET} for origins: ${ORIGINS}"
cat "${cors_file}"

if command -v gcloud >/dev/null 2>&1; then
  gcloud storage buckets update "gs://${BUCKET}" --cors-file="${cors_file}"
elif command -v gsutil >/dev/null 2>&1; then
  gsutil cors set "${cors_file}" "gs://${BUCKET}"
else
  echo "ERROR: neither 'gcloud' nor 'gsutil' found on PATH." >&2
  exit 1
fi

echo "Done. Verify with: gcloud storage buckets describe gs://${BUCKET} --format='value(cors_config)'"
