# tei-batch-proxy

A tiny OpenAI-compatible (`POST /v1/embeddings`) proxy that sits **between Vespa's
`openai-embedder` and TEI** (`text-embeddings-inference`).

## Why this exists

On GKE (`xyne-vespa`), Vespa embeds documents at index time via `input chunks | embed`,
which sends the **entire `chunks` array in one request** to the embedder. The embedder is
TEI (`vespa-embedder`, `BAAI/bge-base-en-v1.5`) started with `--max-client-batch-size 1000`.

A large document (e.g. a 1885-chunk PDF) therefore fails with:

```
Embedding API request failed with status 413:
{"message":"batch size 1885 > maximum allowed batch size 1000","code":413,"type":"Validation"}
```

This proxy accepts a request of **any** size, splits `input` into
`EMBEDDINGS_BATCH_SIZE` (default 512) sub-batches, calls TEI for each (with retry/backoff),
re-indexes + sorts the results, and returns one OpenAI-shaped response. So no single
TEI request ever exceeds its cap — the 413 cannot happen regardless of document size.

It keeps the **same model and dimension** (bge-base, 768-dim), so **no re-index** is needed.

## Configuration (env)

| Var | Default | Notes |
|-----|---------|-------|
| `UPSTREAM_EMBEDDINGS_URL` | `http://vespa-embedder:80/v1/embeddings` | TEI upstream for `POST /v1/embeddings` (every document type except `file`) |
| `UPSTREAM_FILE_EMBEDDINGS_URL` | `UPSTREAM_EMBEDDINGS_URL` | TEI upstream for `POST /v1/embeddings/file` (the `file` document type) |
| `EMBEDDINGS_BATCH_SIZE` | `256` (we set `512`) | Must be `< TEI --max-client-batch-size` |
| `UPSTREAM_CONCURRENCY` | `1` | Concurrent sub-batch requests to TEI |
| `MAX_RETRIES` | `8` | Retries on 429/5xx with exponential backoff |
| `REQUEST_TIMEOUT_MS` | `1800000` | Per-upstream-request timeout (30 min) |
| `PROXY_PAYLOAD_LIMIT_BYTES` | `200000000` | Max inbound body size (200 MB) |
| `PORT` | `8080` | Listen port |

Routes: `POST /v1/embeddings`, `POST /v1/embeddings/file` (proxied), `GET /health`.

## Build

Pure Node stdlib — no dependencies.

```bash
docker build -t <REGISTRY>/tei-batch-proxy:<tag> tei-batch-proxy/
docker push <REGISTRY>/tei-batch-proxy:<tag>
```

## Deploy

Per-environment manifests live in `deploy/k8s/sandbox/` and `deploy/k8s/prod/`. Set the
`image:` field to the image you pushed, then:

```bash
kubectl apply -f tei-batch-proxy/deploy/k8s/<env>/tei-batch-proxy.yaml
kubectl -n xyne-vespa rollout status deploy/tei-batch-proxy
```

For Helm installs, use the `xyne-tei-batch-proxy` chart in `helm-charts/charts/`.

## REQUIRED: point Vespa at the proxy

Deploying the proxy alone does nothing until Vespa's embedder endpoint is repointed
from TEI directly to this proxy. In the Vespa app package's `services.xml`:

```xml
<component id="embedder" type="openai-embedder">
    <model>BAAI/bge-base-en-v1.5</model>
    <dimensions>768</dimensions>
    <!-- was: http://vespa-embedder.../v1/embeddings -->
    <endpoint>http://tei-batch-proxy.xyne-vespa.svc.cluster.local:8088/v1/embeddings</endpoint>
</component>
```

Then redeploy the Vespa application package. (This `services.xml` change lives in the
Vespa deployment repo, not here.)

## Verify

```bash
# 200 with N embeddings for an oversized batch (would 413 against TEI directly):
kubectl -n xyne-vespa run curltest --rm -it --image=curlimages/curl --restart=Never -- \
  sh -c 'python3 - <<PY | curl -s -XPOST http://tei-batch-proxy:8088/v1/embeddings -H "content-type: application/json" -d @- | head -c 200
import json;print(json.dumps({"model":"bge","input":["x"]*1885}))
PY'
```
