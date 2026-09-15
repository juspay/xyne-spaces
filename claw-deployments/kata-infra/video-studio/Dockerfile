# Video-explainer "studio" renderer image. It extends the standard workspace
# server image so Kata's /execute, /upload, and /download API stays unchanged,
# and adds every animation engine the create-video-explainer tool can drive so
# that ALL scene kinds render in ONE sandbox with no internet at runtime.
#
# The base image (agent-workspace) already ships ffmpeg + ffprobe and chromium,
# which cover the 5 static scene kinds (title, diagram, code, diff, bullets).
# This image adds the two animated kinds:
#   - manim  -> Manim Community (Cairo renderer), 1080p/30fps Python scenes.
#   - d2     -> offline D2 -> SVG (d2) -> PNG (rsvg-convert) -> ffmpeg reveal.
#
# Runtime is egress-free (NetworkPolicy egress:[], no SA token, non-root, caps
# dropped -- see the template YAML). Narration TTS is fetched by the claw pod and
# injected into the box as an MP3 file, so the S2S key never enters the sandbox
# and the box needs no network. All package installs below happen at BUILD time
# (in CI, which has network); nothing is fetched at run time.
ARG AGENT_WORKSPACE_IMAGE=agent-workspace:local
FROM ${AGENT_WORKSPACE_IMAGE}

LABEL org.opencontainers.image.title="video-studio" \
      org.opencontainers.image.description="Single-box multi-engine renderer for create-video-explainer (manim + d2 + rsvg)" \
      org.opencontainers.image.vendor="Xyne Spaces"

USER root

# --- Manim (Cairo) -------------------------------------------------------------
# Same toolchain xyne-lens uses. LaTeX is enabled by default because Manim's
# MathTex/Tex helpers need it; set VIDEO_STUDIO_WITH_TEX=0 for a text-only image.
ARG VIDEO_STUDIO_WITH_TEX=1
ARG MANIM_VERSION=0.20.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-dev python3-pip \
       build-essential pkg-config \
       libcairo2-dev libpango1.0-dev libgl1 \
       ffmpeg fonts-dejavu-core fontconfig \
       librsvg2-bin ca-certificates curl \
  && if [ "${VIDEO_STUDIO_WITH_TEX}" = "1" ]; then \
       apt-get install -y --no-install-recommends \
         texlive-latex-base texlive-latex-recommended texlive-latex-extra \
         texlive-fonts-recommended dvisvgm ghostscript; \
     fi \
  && python3 -m pip install --no-cache-dir --break-system-packages "manim==${MANIM_VERSION}" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# --- D2 (single static Go binary; pinned release) ------------------------------
# Downloaded at BUILD time only. The runtime box has no network -- d2 runs fully
# offline (D2_LAYOUT=dagre, the bundled layout engine; no headless browser).
ARG D2_VERSION=0.7.1
ARG D2_SHA256_AMD64=eb172adf59f38d1e5a70ab177591356754ffaf9bebb84e0ca8b767dfb421dad7
ARG D2_SHA256_ARM64=ce3a0b985a8f91335a826c254b3a88736fd81afcdd08b58f6c749d2add6864b0
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) d2arch=amd64; d2sha="$D2_SHA256_AMD64" ;; \
      arm64) d2arch=arm64; d2sha="$D2_SHA256_ARM64" ;; \
      *) echo "unsupported arch $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/d2lang/d2/releases/download/v${D2_VERSION}/d2-v${D2_VERSION}-linux-${d2arch}.tar.gz" \
      -o /tmp/d2.tar.gz; \
    echo "${d2sha}  /tmp/d2.tar.gz" | sha256sum -c -; \
    tar -C /tmp -xzf /tmp/d2.tar.gz; \
    install -m 0755 "/tmp/d2-v${D2_VERSION}/bin/d2" /usr/local/bin/d2; \
    rm -rf /tmp/d2.tar.gz "/tmp/d2-v${D2_VERSION}"; \
    d2 --version

# Smoke-check every engine is on PATH at build time so a broken image fails CI,
# not a user's render.
RUN command -v ffmpeg && command -v ffprobe && command -v manim \
  && command -v d2 && command -v rsvg-convert

USER 1000:1000
