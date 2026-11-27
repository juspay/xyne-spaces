#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "keychain-label is macOS only. Skipping build."
  exit 0
fi

echo "Building keychain-label universal binary..."

for arch in arm64 x86_64; do
  clang main.c \
    -O2 \
    -Wall -Werror \
    -framework Security \
    -framework CoreFoundation \
    -target "${arch}-apple-macos12.0" \
    -o "keychain-label-${arch}"
done

lipo -create keychain-label-arm64 keychain-label-x86_64 -output keychain-label
rm keychain-label-arm64 keychain-label-x86_64

chmod +x keychain-label
echo "Built universal binary: keychain-label"
