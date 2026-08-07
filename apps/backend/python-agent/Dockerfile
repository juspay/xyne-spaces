FROM mirror.gcr.io/library/python:3.11-slim

WORKDIR /app

ARG DIARIZATION_ENABLED=false
ARG TORCH_VERSION=2.13.0+cpu
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu

# Keep the HF cache outside /app because development bind-mounts /app.
ENV HOME=/app \
    HF_HOME=/models/huggingface \
    HF_HUB_CACHE=/models/huggingface/hub \
    TRANSFORMERS_CACHE=/models/huggingface \
    TORCH_HOME=/app/.cache/torch \
    XDG_CACHE_HOME=/app/.cache \
    XDG_CONFIG_HOME=/app/.config \
    MPLCONFIGDIR=/app/.config/matplotlib \
    DIARIZATION_ENABLED=${DIARIZATION_ENABLED}

# Install system dependencies required by LiveKit SDK and health checks
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    libglib2.0-0 \
    libgstreamer1.0-0 \
    gstreamer1.0-plugins-base \
    && rm -rf /var/lib/apt/lists/*

# Create runtime-writable directories before pip/model imports touch caches
RUN mkdir -p /app/transcriptions /models/huggingface/hub /app/.cache/torch /app/.config/matplotlib \
    && chmod -R 777 /app/transcriptions /models /app/.cache /app/.config

# Copy requirements and install Python dependencies
COPY requirements.txt .
COPY requirements-diarization.txt .
COPY verify_livekit_stack.py .
RUN pip install --no-cache-dir "torch==${TORCH_VERSION}" --index-url "${TORCH_INDEX_URL}"
RUN pip install --no-cache-dir -r requirements.txt
RUN pip check && python verify_livekit_stack.py
RUN case "$DIARIZATION_ENABLED" in \
        true|True|TRUE|1|yes|Yes|YES|on|On|ON) \
            echo "Installing diarization dependencies"; \
            pip install --no-cache-dir -r requirements-diarization.txt; \
            ;; \
        *) \
            echo "Skipping diarization dependencies because DIARIZATION_ENABLED=$DIARIZATION_ENABLED"; \
            ;; \
    esac

# Pre-download model files (ONNX model, tokenizer, languages.json)
# Keep this layer independent from application code so source edits do not
# invalidate the multi-gigabyte model download.
COPY download_models.py .
RUN python download_models.py \
    && python -m livekit.agents download-files

# Copy application code after stable dependency/model layers.
COPY . .

CMD ["python", "main.py", "start"]
