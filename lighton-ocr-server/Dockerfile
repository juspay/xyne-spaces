FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    fonts-dejavu-core \
    libglib2.0-0 \
    libgl1 \
    libreoffice-impress \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 1200 --retries 10 -r requirements.txt

# Only the E5 tokenizer is needed locally; embeddings/model inference stay outside.
RUN python3 -c "from huggingface_hub import snapshot_download; snapshot_download('intfloat/multilingual-e5-large-instruct', local_dir='/app/e5-tokenizer', allow_patterns=['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt'])"

ENV PYTHONPATH=/app
COPY src/ ./

RUN python3 -c "from pathlib import Path; assert Path('/app/e5-tokenizer/tokenizer.json').exists()"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
