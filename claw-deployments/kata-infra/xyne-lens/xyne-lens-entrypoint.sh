#!/bin/sh
# Credential-free startup for the local Xyne Lens renderer. The inherited
# agent-workspace entrypoint is deliberately NOT used because it bootstraps a
# private development repository and SSH/Attic credentials before serving.
set -eu

mkdir -p /workspace/xyne-lens/src /workspace/xyne-lens/results /workspace/xyne-lens/build
cd /app
exec node --import tsx/esm /app/src/main.ts
