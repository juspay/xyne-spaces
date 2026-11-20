#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "transit-key (Secure Enclave) is macOS only. Skipping build."
  exit 0
fi

echo "Building transit-key universal binary..."

# Compile for Apple Silicon
swiftc secure-enclave.swift -O -target arm64-apple-macos12.0 -o transit-key-arm64

# Compile for Intel (Macs with a T2 chip have a Secure Enclave)
swiftc secure-enclave.swift -O -target x86_64-apple-macos12.0 -o transit-key-x86_64

# Create universal binary
lipo -create transit-key-arm64 transit-key-x86_64 -output transit-key

# Clean up arch-specific binaries
rm transit-key-arm64 transit-key-x86_64
