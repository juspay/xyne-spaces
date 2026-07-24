#!/usr/bin/env bash
#
# run-trivy-local.sh — reproduce the CI Trivy scan on your machine (Docker-based; the
# `trivy` binary is NOT required). Mirrors the Jenkins "Security Scan" source stage.
#
# Scope: SOURCE TREE (filesystem) ONLY. Container image scanning was removed — both here and
# in the Jenkinsfile — because it was flaky on the remote dind daemon (Trivy cache-lock
# timeouts) and mostly surfaced base-image vulnerabilities the app can't remediate.
#
# Usage:
#   ./scripts/run-trivy-local.sh          # scan the repo (fs)
#
# Behaviour is controlled by the same flag as CI:
#   SECURITY_BREAK_BUILD=false|true   (default false)  false=warn & pass, true=fail on HIGH/CRITICAL
#
# Trivy scans vulnerabilities (+ misconfig on the source tree). Secrets are handled by
# gitleaks (husky hooks + the CI gitleaks stage), not Trivy.
#
# Examples:
#   ./scripts/run-trivy-local.sh
#   SECURITY_BREAK_BUILD=true ./scripts/run-trivy-local.sh
#
set -euo pipefail

SECURITY_BREAK_BUILD="${SECURITY_BREAK_BUILD:-false}"
TRIVY_VERSION="${TRIVY_VERSION:-0.72.0}"
TRIVY_IMAGE="${TRIVY_IMAGE:-public.ecr.aws/aquasecurity/trivy:${TRIVY_VERSION}}"
# Node-level cache dir in CI; a stable per-user dir locally so the DB is downloaded once.
TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy-xyne}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_REPORT_DIR="$REPO_ROOT/security-reports"
SOURCE_JSON="/scan/security-reports/trivy-fs.json"

if [ "$SECURITY_BREAK_BUILD" = "true" ]; then EXIT_CODE=1; else EXIT_CODE=0; fi
FS_SCANNERS="vuln,misconfig"
SOURCE_SKIP_DIRS=(--skip-dirs /scan/.securitybin --skip-dirs /scan/security-reports --skip-dirs '**/node_modules' --skip-dirs '**/dist')
REPO_MOUNT=(-v "$REPO_ROOT:/scan" -v "$TRIVY_CACHE_DIR:/root/.cache/")

mkdir -p "$TRIVY_CACHE_DIR" "$LOCAL_REPORT_DIR"
echo "== Trivy local scan (source/fs only) =="
echo "   SECURITY_BREAK_BUILD=$SECURITY_BREAK_BUILD  -> gate --exit-code=$EXIT_CODE"
echo "   image=$TRIVY_IMAGE  cache=$TRIVY_CACHE_DIR"
echo "   reports=$LOCAL_REPORT_DIR"
echo

source_gate_failed=false

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

if [ "$source_gate_failed" = true ]; then
  echo
  echo "== Trivy gate FAILED ==" >&2
  echo "   Source scan has HIGH/CRITICAL findings." >&2
  exit 1
fi

echo
echo "== Trivy scan complete (gate passed) =="
