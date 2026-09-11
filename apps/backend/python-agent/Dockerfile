FROM mirror.gcr.io/library/python:3.11-slim

WORKDIR /app

ARG DIARIZATION_ENABLED=false

# Redirect all cache/config dirs to /app so the container never writes to / or /.cache
ENV HOME=/app \
    HF_HOME=/app/.cache/huggingface \
    HF_HUB_CACHE=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
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
RUN mkdir -p /app/transcriptions /app/.cache/huggingface /app/.cache/torch /app/.config/matplotlib \
    && chmod -R 777 /app/transcriptions /app/.cache /app/.config

# Copy requirements and install Python dependencies
COPY requirements.txt .
COPY requirements-diarization.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN case "$DIARIZATION_ENABLED" in \
        true|True|TRUE|1|yes|Yes|YES|on|On|ON) \
            echo "Installing diarization dependencies"; \
            pip install --no-cache-dir -r requirements-diarization.txt; \
            ;; \
        *) \
            echo "Skipping diarization dependencies because DIARIZATION_ENABLED=$DIARIZATION_ENABLED"; \
            ;; \
    esac

# Copy application code
COPY . .

# Run as an unprivileged user. Created before the model download so the caches under /app
# are owned by the account that reads and updates them at runtime.
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Pre-download model files (ONNX model, tokenizer, languages.json)
# Using dedicated script to avoid heavy main.py imports that need env vars
RUN python download_models.py

CMD ["python", "main.py", "start"]
