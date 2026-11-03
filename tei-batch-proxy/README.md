# tei-batch-proxy

A tiny OpenAI-compatible (`POST /v1/embeddings`) proxy that sits **between Vespa's
`openai-embedder` and TEI** (`text-embeddings-inference`).

## Why this exists

Vespa embeds documents at index time via `input chunks | embed`,
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
| `UPSTREAM_EMBEDDINGS_URL` | `http://vespa-embedder:80/v1/embeddings` | The TEI service to fan out to |
| `EMBEDDINGS_BATCH_SIZE` | `256` (we set `512`) | Must be `< TEI --max-client-batch-size` |
| `UPSTREAM_CONCURRENCY` | `1` | Concurrent sub-batch requests to TEI |
| `MAX_RETRIES` | `8` | Retries on 429/5xx with exponential backoff |
| `REQUEST_TIMEOUT_MS` | `1800000` | Per-upstream-request timeout (30 min) |
| `PROXY_PAYLOAD_LIMIT_BYTES` | `200000000` | Max inbound body size (200 MB) |
| `PORT` | `8080` | Listen port |
| `TEI_PROXY_S2S_KEY` | unset | Shared key. Every route except `/health` requires `Authorization: Bearer <key>`; unset = every request gets `401` |

Routes: `POST /v1/embeddings` (proxied), `GET /health`.

## Authentication

Every route except `GET /health` (left open for the kubelet probes) requires
`Authorization: Bearer <TEI_PROXY_S2S_KEY>`, compared in constant time; anything else is `401`.
The caller is Vespa's `openai-embedder`, which can only send that one header: both components
set `<api-key-secret-ref>teiProxyS2sKey</api-key-secret-ref>`, and self-hosted Vespa resolves
that ref from the env var `VESPA_SECRET_TEI_PROXY_S2S_KEY` on the feed and query pods (it
fails to start the embedders if the variable is missing). Both sides read the same key,
`TEI_PROXY_S2S_KEY` in the `xyne-vespa-secrets` Secret. The proxy never forwards the inbound
`Authorization` header to TEI.

`POST /v1/embeddings/file` does the same against `UPSTREAM_FILE_EMBEDDINGS_URL`
(defaults to `UPSTREAM_EMBEDDINGS_URL`), so file chunks can go to a separate embedder.

## Build

Pure Node stdlib, no dependencies. The image runs as uid 10001 and needs no writable
filesystem. It is published with the other images by `.github/workflows/publish-images.yml`
(entry `tei-batch-proxy` in `ci/images.json`) as `ghcr.io/juspay/xyne-spaces-tei-batch-proxy`.
A local build:

```bash
docker build -t tei-batch-proxy tei-batch-proxy/
```

## Deploy

Through the `xyne-tei-batch-proxy` Helm chart, which the deployment's root chart installs
with Vespa (`enable_vespa = true`), next to the embedder and the Vespa application package.
The Service is `tei-batch-proxy:8080`, and both embedder components in
`vespa-core/vespa` (`hf-embedder` and `embed-file`) already point at it. See
`deployment/docs/features/search.md`.

## Verify

The proxy's port is in the mesh with strict mTLS, so call it from a pod that has a sidecar,
such as the backend:

```bash
kubectl -n <namespace> exec deploy/xyne-backend -c xyne-backend -- node -e '
fetch("http://tei-batch-proxy:8080/v1/embeddings",{method:"POST",headers:{"content-type":"application/json",
  authorization:"Bearer <TEI_PROXY_S2S_KEY>"},
  body:JSON.stringify({model:"BAAI/bge-base-en-v1.5",input:["hello"]})})
.then(async r=>{const d=await r.json();console.log(r.status,d.data?.[0]?.embedding?.length)})'
```

`200 768` means the proxy reaches TEI; `401` means the key is missing or wrong.
