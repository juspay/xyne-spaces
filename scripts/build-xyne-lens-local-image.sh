#!/usr/bin/env bash
# Build only a LOCAL Xyne Lens sandbox image. This script does not authenticate
# to a registry, push an image, configure kubectl, or apply Kubernetes objects.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_ref="${XYNE_LENS_LOCAL_IMAGE:-xyne-lens:local}"
# A local workspace-agent image is required. The script refuses to pull a base
# image or contact a registry so local testing remains fully local.
base_image="${XYNE_LENS_BASE_IMAGE:-agent-workspace:local}"
with_tex="${XYNE_LENS_WITH_TEX:-1}"

command -v docker >/dev/null || { echo "Missing required command: docker" >&2; exit 1; }
docker info >/dev/null || { echo "Docker is not running" >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || {
  echo "Local base image not found: $base_image" >&2
  echo "Build/tag the workspace-agent image locally, then retry with:" >&2
  echo "  XYNE_LENS_BASE_IMAGE=<your-local-agent-workspace-image> $0" >&2
  exit 1
}

echo "Building local-only image ${image_ref} for linux/amd64"
echo "Base image: ${base_image}"
docker buildx build \
  --platform linux/amd64 \
  --load \
  --build-arg "AGENT_WORKSPACE_IMAGE=${base_image}" \
  --build-arg "XYNE_LENS_WITH_TEX=${with_tex}" \
  --tag "$image_ref" \
  "$repo_root/claw-deployments/kata-infra/xyne-lens"

echo
echo "Built locally: ${image_ref}"
echo "No registry or Kubernetes changes were made."
