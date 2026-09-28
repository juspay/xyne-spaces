# tei-batch-proxy: a tiny OpenAI-/v1/embeddings-compatible proxy that sits between
# Vespa's openai-embedder and TEI (text-embeddings-inference). It splits an embedding
# request of ANY size into <= EMBEDDINGS_BATCH_SIZE sub-batches so a large document
# (e.g. 1885 chunks) never exceeds TEI's --max-client-batch-size and 413s.
#
# Pure Node stdlib (http + global fetch) — no npm dependencies, no package.json needed.
FROM node:20-alpine

WORKDIR /app
COPY tei-batch-proxy.js /app/tei-batch-proxy.js

ENV PORT=8080
EXPOSE 8080

# Lightweight healthcheck against the proxy's /health route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/health || exit 1

CMD ["node", "/app/tei-batch-proxy.js"]
