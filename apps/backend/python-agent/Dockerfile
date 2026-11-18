# Build stage: has pip, gcc and a shell. None of it ships in the final image.
# It uses Debian 12's own python3 (3.11.2), the same interpreter the distroless image ships,
# so pip resolves environment markers (e.g. python_full_version) the same way in both stages.
FROM mirror.gcr.io/library/debian:12-slim AS build

ARG DIARIZATION_ENABLED=false

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-dev \
        gcc \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Debian's bundled pip is too old for this hash-pinned requirements.txt.
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir pip==25.1.1

ENV PATH=/opt/venv/bin:$PATH \
    HOME=/app \
    HF_HOME=/app/.cache/huggingface \
    HF_HUB_CACHE=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    TORCH_HOME=/app/.cache/torch \
    XDG_CACHE_HOME=/app/.cache \
    XDG_CONFIG_HOME=/app/.config \
    MPLCONFIGDIR=/app/.config/matplotlib

COPY requirements.txt requirements-diarization.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
RUN case "$DIARIZATION_ENABLED" in \
        true|True|TRUE|1|yes|Yes|YES|on|On|ON) \
            echo "Installing diarization dependencies"; \
            pip install --no-cache-dir -r requirements-diarization.txt; \
            ;; \
        *) \
            echo "Skipping diarization dependencies because DIARIZATION_ENABLED=$DIARIZATION_ENABLED"; \
            ;; \
    esac

COPY . .

# Bake the model files into the image (turn detector, Silero VAD). The runtime image runs
# with HF_HUB_OFFLINE=1, so a model missing here fails at startup instead of downloading later.
RUN python download_models.py \
    && mkdir -p /app/transcriptions /app/.config/matplotlib \
    && rm -f Dockerfile requirements-diarization.txt system.excalidraw

# Runtime: distroless Python 3.11 on Debian 12. No shell, no package manager, no curl.
# The chart's health checks are httpGet probes run by the kubelet, so they need nothing here.
FROM gcr.io/distroless/python3-debian12:nonroot

ARG DIARIZATION_ENABLED=false

WORKDIR /app

ENV HOME=/app \
    HF_HOME=/app/.cache/huggingface \
    HF_HUB_CACHE=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    TORCH_HOME=/app/.cache/torch \
    XDG_CACHE_HOME=/app/.cache \
    XDG_CONFIG_HOME=/app/.config \
    MPLCONFIGDIR=/app/.config/matplotlib \
    HF_HUB_OFFLINE=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/venv/lib/python3.11/site-packages \
    DIARIZATION_ENABLED=${DIARIZATION_ENABLED}

COPY --from=build /opt/venv/lib/python3.11/site-packages /opt/venv/lib/python3.11/site-packages
# uid 1001 matches runAsUser/fsGroup in the xyne-transcription-agent chart.
COPY --from=build --chown=1001:1001 /app /app

USER 1001:1001

EXPOSE 8080

ENTRYPOINT ["/usr/bin/python3", "main.py"]
CMD ["start"]
