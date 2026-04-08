#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$OSTYPE" == "msys"* ]] || [[ "$OSTYPE" == "win32" ]]; then
  echo "mic-monitor is not yet supported on windows. Skipping build."
  exit 0
fi

if [[ "$OSTYPE" == "linux"* ]]; then
  echo "mic-monitor is not yet supported on linux. Skipping build."
  exit 0
fi

echo "Building mic-monitor universal binary..."

# Compile for Apple Silicon
clang main.c \
  -O2 \
  -framework CoreAudio \
  -framework CoreFoundation \
  -framework AppKit \
  -target arm64-apple-macos12.0 \
  -o mic-monitor-arm64

# Compile for Intel
clang main.c \
  -O2 \
  -framework CoreAudio \
  -framework CoreFoundation \
  -framework AppKit \
  -target x86_64-apple-macos12.0 \
  -o mic-monitor-x86_64

# Create universal binary
lipo -create mic-monitor-arm64 mic-monitor-x86_64 \
  -output mic-monitor

# Clean up arch-specific binaries
rm mic-monitor-arm64 mic-monitor-x86_64

chmod +x mic-monitor
echo "Built universal binary: mic-monitor"
