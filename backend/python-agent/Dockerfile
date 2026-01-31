FROM mirror.gcr.io/library/python:3.11-slim

WORKDIR /app

# Set Hugging Face cache directory to a persistent location
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

# Install system dependencies required by LiveKit SDK and health checks
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    libglib2.0-0 \
    libgstreamer1.0-0 \
    gstreamer1.0-plugins-base \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Pre-download model files (ONNX model, tokenizer, languages.json)
# Using dedicated script to avoid heavy main.py imports that need env vars
RUN python download_models.py

# Create directories
RUN mkdir -p /app/transcriptions

CMD ["python", "main.py", "start"]
