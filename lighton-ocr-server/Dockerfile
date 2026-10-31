# Hardened runtime: distroless Python (no shell, package manager or pip), pinned by digest.
# The Python deps are assembled in a Debian 12 builder whose python3 (3.11) matches the
# distroless interpreter. Office files arrive already converted to PDF (the backend's
# Ream conversion), so there is no LibreOffice here.
FROM debian:12-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-dejavu-core \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /venv \
    && /venv/bin/pip install --no-cache-dir --timeout 1200 --retries 10 -r /tmp/requirements.txt \
    && /venv/bin/pip uninstall -y pip

# Only the E5 tokenizer is needed locally; embeddings/model inference stay outside.
RUN /venv/bin/python3 -c "from huggingface_hub import snapshot_download; snapshot_download('intfloat/multilingual-e5-large-instruct', local_dir='/app/e5-tokenizer', allow_patterns=['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt'])" \
    && rm -rf /app/e5-tokenizer/.cache \
    && test -f /app/e5-tokenizer/tokenizer.json

FROM gcr.io/distroless/python3-debian12:nonroot@sha256:7d1042ce588ab97019fe95c24ffca7bc5a82ccdac572511d5e09bda4435c89c5

COPY --from=builder /venv /venv
COPY --from=builder /app/e5-tokenizer /app/e5-tokenizer
# DejaVu Sans draws .txt uploads as page images (renderer._load_text_font).
COPY --from=builder /usr/share/fonts/truetype/dejavu /usr/share/fonts/truetype/dejavu

WORKDIR /app
COPY src/ ./

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp

EXPOSE 8000
# No shell/curl in distroless, so probe /health with python (k8s uses the chart's probes).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD ["/venv/bin/python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).status == 200 else 1)"]

# Matches the chart's runAsUser.
USER 1001:1001

ENTRYPOINT ["/venv/bin/python3", "-m", "uvicorn"]
CMD ["main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
