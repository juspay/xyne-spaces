# tei-batch-proxy: a tiny OpenAI-/v1/embeddings-compatible proxy that sits between
# Vespa's openai-embedder and TEI (text-embeddings-inference). It splits an embedding
# request of ANY size into <= EMBEDDINGS_BATCH_SIZE sub-batches so a large document
# (e.g. 1885 chunks) never exceeds TEI's --max-client-batch-size and 413s.
#
# Pure Node stdlib (http + global fetch) — no npm dependencies, no package.json needed.
# Hardened runtime: distroless (no shell, package manager or npm), pinned by digest.
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

WORKDIR /app
# Root-owned and read-only to the runtime user.
COPY --chmod=0444 tei-batch-proxy.js /app/tei-batch-proxy.js

ENV PORT=8080 \
    NODE_ENV=production
EXPOSE 8080

# No shell/wget in distroless, so probe /health with node itself (k8s uses the chart's probes).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Matches the chart's runAsUser/runAsGroup.
USER 10001:10001

# Base image ENTRYPOINT is /nodejs/bin/node.
CMD ["/app/tei-batch-proxy.js"]
