#!/usr/bin/env bash
#
# run-trivy-local.sh — reproduce the CI Trivy scans on your machine (Docker-based; the
# `trivy` binary is NOT required). Mirrors the Jenkins "Security Scan" stages.
#
# Usage:
#   ./scripts/run-trivy-local.sh                      # scan the repo (fs) only
#   ./scripts/run-trivy-local.sh <local-image:tag>    # also scan a built container image
#
# Behaviour is controlled by the same flag as CI:
#   SECURITY_BREAK_BUILD=false|true   (default false)  false=warn & pass, true=fail on HIGH/CRITICAL
#
# Trivy scans vulnerabilities (+ misconfig on the source tree). Secrets are handled by
# gitleaks (husky hooks + the CI gitleaks stage), not Trivy.
#
# Examples:
#   SECURITY_BREAK_BUILD=true ./scripts/run-trivy-local.sh
#   ./scripts/run-trivy-local.sh xyne-spaces-backend:$(git rev-parse --short=10 HEAD)
#
set -euo pipefail

SECURITY_BREAK_BUILD="${SECURITY_BREAK_BUILD:-false}"
TRIVY_VERSION="${TRIVY_VERSION:-0.72.0}"
TRIVY_IMAGE="${TRIVY_IMAGE:-public.ecr.aws/aquasecurity/trivy:${TRIVY_VERSION}}"
# Node-level cache dir in CI; a stable per-user dir locally so the DB is downloaded once.
TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy-xyne}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_REF="${1:-}"
LOCAL_REPORT_DIR="$REPO_ROOT/security-reports"
SOURCE_JSON="/scan/security-reports/trivy-fs.json"

if [ "$SECURITY_BREAK_BUILD" = "true" ]; then EXIT_CODE=1; else EXIT_CODE=0; fi
FS_SCANNERS="vuln,misconfig"; IMG_SCANNERS="vuln"
SOURCE_SKIP_DIRS=(--skip-dirs /scan/.securitybin --skip-dirs /scan/security-reports --skip-dirs '**/node_modules' --skip-dirs '**/dist')
REPO_MOUNT=(-v "$REPO_ROOT:/scan" -v "$TRIVY_CACHE_DIR:/root/.cache/")
IMAGE_MOUNT=(-v "$REPO_ROOT:/scan" -v /var/run/docker.sock:/var/run/docker.sock -v "$TRIVY_CACHE_DIR:/root/.cache/")

mkdir -p "$TRIVY_CACHE_DIR" "$LOCAL_REPORT_DIR"
echo "== Trivy local scan =="
echo "   SECURITY_BREAK_BUILD=$SECURITY_BREAK_BUILD  -> gate --exit-code=$EXIT_CODE"
echo "   image=$TRIVY_IMAGE  cache=$TRIVY_CACHE_DIR"
echo "   reports=$LOCAL_REPORT_DIR"
echo

source_gate_failed=false
image_gate_failed=false

echo "== [1/2] Source scan (fs): write full findings JSON (warnings, never fails) =="
docker run --rm "${REPO_MOUNT[@]}" \
  "$TRIVY_IMAGE" fs --scanners "$FS_SCANNERS" "${SOURCE_SKIP_DIRS[@]}" \
  --format json -o "$SOURCE_JSON" --exit-code 0 --no-progress /scan

docker run --rm "${REPO_MOUNT[@]}" \
  "$TRIVY_IMAGE" convert --format table "$SOURCE_JSON"

echo
echo "== [2/2] Source scan (fs): GATE (HIGH,CRITICAL, exit-code=$EXIT_CODE) =="
if ! docker run --rm "${REPO_MOUNT[@]}" \
  "$TRIVY_IMAGE" convert --severity HIGH,CRITICAL --exit-code "$EXIT_CODE" "$SOURCE_JSON"; then
  source_gate_failed=true
fi

if [ -n "$IMAGE_REF" ]; then
  SAFE_IMAGE_REF="$(printf '%s' "$IMAGE_REF" | tr -c 'A-Za-z0-9._-' '-')"
  IMAGE_JSON="/scan/security-reports/trivy-image-${SAFE_IMAGE_REF}.json"

  echo
  echo "== Image scan: $IMAGE_REF - write full findings JSON (warnings) =="
  docker run --rm "${IMAGE_MOUNT[@]}" \
    "$TRIVY_IMAGE" image --scanners "$IMG_SCANNERS" --ignore-unfixed \
    --format json -o "$IMAGE_JSON" --exit-code 0 --no-progress "$IMAGE_REF"

  docker run --rm "${REPO_MOUNT[@]}" \
    "$TRIVY_IMAGE" convert --format table "$IMAGE_JSON"

  echo
  echo "== Image scan: $IMAGE_REF - GATE (HIGH,CRITICAL, exit-code=$EXIT_CODE) =="
  if ! docker run --rm "${REPO_MOUNT[@]}" \
    "$TRIVY_IMAGE" convert --severity HIGH,CRITICAL --exit-code "$EXIT_CODE" "$IMAGE_JSON"; then
    image_gate_failed=true
  fi
fi

if [ "$source_gate_failed" = true ] || [ "$image_gate_failed" = true ]; then
  echo
  echo "== Trivy gate FAILED ==" >&2
  if [ "$source_gate_failed" = true ]; then
    echo "   Source scan has HIGH/CRITICAL findings." >&2
  fi
  if [ "$image_gate_failed" = true ]; then
    echo "   Image scan has HIGH/CRITICAL findings." >&2
  fi
  exit 1
fi

echo
echo "== Trivy scan complete (gate passed) =="
