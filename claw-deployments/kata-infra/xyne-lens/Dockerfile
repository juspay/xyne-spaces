# Dedicated local Xyne Lens renderer image. It extends the existing workspace
# server image so Kata's /execute, /upload, and /download API stays unchanged.
ARG AGENT_WORKSPACE_IMAGE=agent-workspace:local
FROM ${AGENT_WORKSPACE_IMAGE}

LABEL org.opencontainers.image.title="xyne-lens-local" \
      org.opencontainers.image.description="Local Manim renderer for Xyne Lens" \
      org.opencontainers.image.vendor="Xyne Spaces"

USER root

# `manim`'s Nix closure causes several Python dependencies to compile under
# OrbStack's AMD64 emulation. Debian packages plus PyPI wheels are substantially
# faster for local use. The supported Manim Community skill uses MathTex, Tex,
# amsmath and mathrsfs, so the complete LaTeX toolchain is enabled by default.
# Set XYNE_LENS_WITH_TEX=0 only for a deliberately text-only development image.
ARG XYNE_LENS_WITH_TEX=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-dev python3-pip \
       build-essential pkg-config \
       libcairo2-dev libpango1.0-dev libgl1 \
       ffmpeg fonts-dejavu-core fontconfig \
  && if [ "${XYNE_LENS_WITH_TEX}" = "1" ]; then \
       apt-get install -y --no-install-recommends \
         texlive-latex-base texlive-latex-recommended texlive-latex-extra \
         texlive-fonts-recommended dvisvgm ghostscript; \
     fi \
  && python3 -m pip install --no-cache-dir --break-system-packages "manim==0.19.0" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace/xyne-lens/src /workspace/xyne-lens/results /workspace/xyne-lens/build \
  && chown -R 1000:1000 /workspace/xyne-lens

COPY xyne-lens-entrypoint.sh /usr/local/bin/xyne-lens-entrypoint.sh
RUN chmod 0755 /usr/local/bin/xyne-lens-entrypoint.sh

USER 1000:1000
ENTRYPOINT ["/usr/local/bin/xyne-lens-entrypoint.sh"]
