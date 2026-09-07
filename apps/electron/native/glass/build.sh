#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Same shape as native/mic-monitor/build.sh: plain clang per architecture, then
# lipo. A Node N-API addon is just a dylib exporting napi_register_module_v1, so
# it needs no node-gyp, no node-addon-api and no npm dependency — only the
# node_api.h headers that ship with Node itself.

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "glass backdrop is macOS-only. Skipping build."
  exit 0
fi

NODE_INCLUDE="$(node -p "require('path').resolve(process.execPath, '../../include/node')")"
if [[ ! -f "$NODE_INCLUDE/node_api.h" ]]; then
  echo "error: node_api.h not found under $NODE_INCLUDE" >&2
  echo "       (looked relative to $(command -v node))" >&2
  exit 1
fi

echo "Building glass universal binary..."

for ARCH in arm64 x86_64; do
  clang++ glass.mm \
    -O2 \
    -std=c++17 \
    -shared \
    -undefined dynamic_lookup \
    -fobjc-arc \
    -I"$NODE_INCLUDE" \
    -framework AppKit \
    -framework Foundation \
    -target "${ARCH}-apple-macos12.0" \
    -o "glass-${ARCH}.node"
done

lipo -create glass-arm64.node glass-x86_64.node -output glass.node
rm glass-arm64.node glass-x86_64.node

echo "Built universal binary: glass.node"
