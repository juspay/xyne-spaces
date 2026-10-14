#!/bin/bash
# Copies GoogleService-Info.plist into the main app folder before compile.
# Uses COPY_FIREBASE_VARIANT if explicitly set; otherwise derives from bundle identifier.
set -euo pipefail

ROOT_DIR="$(cd "${SRCROOT}/.." && pwd)"

if [ -n "${COPY_FIREBASE_VARIANT:-}" ]; then
  VARIANT="$COPY_FIREBASE_VARIANT"
else
  # Derive from PRODUCT_BUNDLE_IDENTIFIER (already correct per-variant at prebuild time)
  case "${PRODUCT_BUNDLE_IDENTIFIER:-}" in
    "net.juspay.xynespaces")
      VARIANT="prod"
      ;;
    "net.juspay.xynespacescommunity")
      VARIANT="community"
      ;;
    "net.juspay.xynespaces.sandbox")
      VARIANT="sandbox"
      ;;
    "net.juspay.xyne.spaces.native")
      VARIANT="dev"
      ;;
    *)
      echo "error: Unrecognized bundle identifier '${PRODUCT_BUNDLE_IDENTIFIER:-}', cannot determine Firebase variant"
      exit 1
      ;;
  esac
fi

SOURCE_PLIST="${ROOT_DIR}/assets/configs/${VARIANT}/GoogleService-Info.plist"

if [ ! -f "$SOURCE_PLIST" ]; then
  echo "error: GoogleService-Info.plist not found: $SOURCE_PLIST"
  exit 1
fi

if [ -z "${INFOPLIST_FILE:-}" ]; then
  echo "error: INFOPLIST_FILE is not set"
  exit 1
fi

DEST_DIR="$(dirname "${SRCROOT}/${INFOPLIST_FILE}")"
mkdir -p "$DEST_DIR"
cp -f "$SOURCE_PLIST" "${DEST_DIR}/GoogleService-Info.plist"

echo "[copy-google-service-info] variant=${VARIANT} dest=${DEST_DIR}/GoogleService-Info.plist"
