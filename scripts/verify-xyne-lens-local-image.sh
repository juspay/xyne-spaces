#!/usr/bin/env bash
# Verify the local-only Xyne Lens image against the supported Manim Community
# feature set. This never contacts a registry or Kubernetes cluster.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_ref="${XYNE_LENS_LOCAL_IMAGE:-xyne-lens:local}"
smoke_scene="$repo_root/claw-deployments/kata-infra/xyne-lens/smoke-manimce.py"

command -v docker >/dev/null || { echo "Missing required command: docker" >&2; exit 1; }
docker info >/dev/null || { echo "Docker is not running" >&2; exit 1; }
docker image inspect "$image_ref" >/dev/null 2>&1 || {
  echo "Local Xyne Lens image not found: $image_ref" >&2
  echo "Build it first with ./scripts/build-xyne-lens-local-image.sh" >&2
  exit 1
}

docker run --rm --platform linux/amd64 \
  -v "$smoke_scene:/tmp/lens-manimce-smoke.py:ro" \
  --entrypoint /bin/bash "$image_ref" -lc '
    set -euo pipefail
    for command in manim ffmpeg ffprobe latex dvisvgm gs; do
      command -v "$command" >/dev/null
      printf "%s: %s\n" "$command" "$(command -v "$command")"
    done
    python3 -c "import manim, numpy, scipy; print(\"Python dependencies: manim, numpy, scipy\")"
    manim --renderer=cairo --format=png -s -r 854,480 \
      --media_dir /tmp/lens-manimce-smoke-output \
      /tmp/lens-manimce-smoke.py LensManimCommunitySmoke
  '

echo "Verified complete Manim Community support in $image_ref"
