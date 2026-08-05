# Xyne Lens local sandbox image

Xyne Lens renders model-authored Manim code in a sandbox separate from all
development workspaces. This configuration is deliberately **local-only**: it
does not publish an image, use a cloud project, configure a remote cluster, or
apply a production manifest.

Its fixed output contract is:

- MP4, H.264/yuv420p
- 854×480 (480p)
- 30 fps
- 100 MiB maximum delivery size

## Build locally

Build the image into the local Docker daemon:

```sh
./scripts/build-xyne-lens-local-image.sh
```

The resulting local image is `xyne-lens:local`. The script requires a local
workspace-agent base image named `agent-workspace:local`; point it at another
local tag with `XYNE_LENS_BASE_IMAGE=<local-tag>`. It does not push an image,
configure cloud credentials, or call Kubernetes. The first build downloads
Debian/PyPI dependencies, but all resulting layers remain local.

The default is the complete Manim Community renderer: it supports `Tex`,
`MathTex`, `amsmath`, and `mathrsfs` in addition to Cairo, FFmpeg, NumPy, and
SciPy. This is required by the vendored Manim Community skill. The first build
is materially larger because TeX is installed, but later builds reuse Docker
layers. To intentionally build a smaller text-only image (it cannot run the
full skill), opt out explicitly:

```sh
XYNE_LENS_WITH_TEX=0 XYNE_LENS_LOCAL_IMAGE=xyne-lens:local-text-only \
  ./scripts/build-xyne-lens-local-image.sh
```

`12-xyne-lens-local-template.yaml` is an optional manifest for a **local**
Kubernetes sandbox controller. It deliberately uses namespace `xyne-local`,
template `xyne-lens-local-template`, and `imagePullPolicy: Never`. Do not apply
it to a remote cluster. A local Kubernetes runtime must first be configured to
see the Docker image (for example, by loading it into a kind or minikube node).
The companion `00-xyne-lens-local-namespace.yaml` and
`01-sandbox-router-local.yaml` create only the local namespace and router.

## Local Docker adapter (recommended on Apple Silicon)

The available `agent-workspace` base is AMD64-only. Do not force an AMD64
kind control plane under OrbStack: use the Docker-local adapter instead. Start
the local workspace service after building the image:

```sh
docker run -d --platform linux/amd64 \
  --name xyne-lens-local -p 8888:8888 xyne-lens:local
curl http://127.0.0.1:8888/
```

`xyne-lens-setup` defaults to `http://127.0.0.1:8888` and then uses the same
workspace API for source files, rendering, preview reads, and delivery. It
cleans `/workspace/xyne-lens` after delivery but deliberately leaves the local
container running for the next development session. If Claw itself runs in a
container, set `XYNE_LENS_LOCAL_URL=http://host.docker.internal:8888`.

Before enabling the agent locally, run
`./scripts/verify-xyne-lens-local-image.sh`. It verifies `manim`, FFmpeg,
LaTeX/dvisvgm/Ghostscript, NumPy/SciPy, and renders a Cairo `MathTex` smoke
scene. Then confirm the workspace server is listening on port 8888. A smoke
test through `xyne-lens-render` should confirm the reported width, height,
frame rate, codec, and preview image.

## Isolation model

The template has no service-account token, secrets, repository mounts, SSH key,
or Attic token. It is named `xyne-lens-local-*` throughout so it cannot be
confused with an environment deployment. A claimed pod belongs to one Lens
session and `xyne-lens-deliver` destroys it after reading the validated artifact.

## Artifact handoff

`xyne-lens-deliver` reads only the validated final MP4 and emits the existing
`[ATTACHMENT:...]` contract. `xyne-claw` converts that into a normal attachment
and claw-auth uploads it to the Spaces file service, so the current client video
viewer works without a new UI path. The 100 MiB delivery cap matches the
base64-capable callback path; use a signed streaming artifact gateway if this
needs to grow further.
