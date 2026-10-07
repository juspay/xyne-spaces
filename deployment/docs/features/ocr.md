# Document OCR

Text and layout extraction from scanned PDFs and images, used when files are uploaded.

- [What gets deployed](#what-gets-deployed)
- [Turn it on](#turn-it-on)
- [The GPU pool](#the-gpu-pool)
- [Precision: bf16 or float32](#precision-bf16-or-float32)
- [Using a model server you already run](#using-a-model-server-you-already-run)
- [Check it works](#check-it-works)

## What gets deployed

| Piece | Application | Runs on | Role |
|---|---|---|---|
| OCR service | `xyne-lighton-ocr` (`xyne-lighton-ocr:80`) | `general` pool, CPU | renders pages, calls the model per page, chunks the text; `POST /process` and `/process_async` |
| model server | `xyne-lighton-model` (`xyne-lighton-model:8000`) | `gpu` pool, one GPU | vLLM (`vllm/vllm-openai:v0.29.0`) serving `lightonai/LightOnOCR-2-1B-bbox` through an OpenAI-compatible `/v1/chat/completions` |

With both on, the root chart wires them together: the backend gets
`DOCLING_SERVICE_URL=http://xyne-lighton-ocr:80`, and the OCR service gets
`LIGHTON_URL=http://xyne-lighton-model:8000/v1/chat/completions` and a 300-second
`LIGHTON_TIMEOUT_SECONDS` (dense pages take longer than the 60-second default on smaller GPUs).
The OCR service also reads `REDIS_PASSWORD` from `xyne-backend-secrets` for its async jobs.

## Turn it on

`01-infra.tfvars` (AWS):

```hcl
gpu_enabled = true
```

`02-platform.tfvars`:

```hcl
apps = {
  xyne-lighton-ocr   = { enabled = true }
  xyne-lighton-model = { enabled = true }
}
```

Run `deployment/scripts/setup.sh --env prod`. The root chart installs the NVIDIA device plugin on
the GPU pool as soon as that pool exists. On first start the model server downloads the model
from Hugging Face (about 2 GB) into a 40 GiB scratch volume, which takes a few minutes; its startup
probe allows 15 minutes. A Hugging Face token is only needed for gated models: create a Secret
`xyne-lighton-model-secrets` with key `HF_TOKEN` in the install namespace.

## The GPU pool

Only AWS has a GPU pool today. It is `gpu_enabled` in `01-infra.tfvars`:

| Setting | Default |
|---|---|
| instance types, tried in order when one is out of capacity | `g6.xlarge` (L4), `g5.xlarge` (A10G), `g6e.xlarge` (L40S), `g4dn.xlarge` (T4) |
| nodes | 1 to 2 |
| image | `AL2023_x86_64_NVIDIA` |
| taint | `nvidia.com/gpu=present:NoSchedule` |

Each type is placed only in the zones that offer it, so a type missing from one zone still works.
GPU capacity is often short; AWS falls through the list until one launches. Change the list with
`node_pools.gpu.instance_types`. The pool allows two nodes because two workloads can need a GPU:
this model server and the [search](search.md) embedder.

GCP and Azure have no GPU pool yet, so the model server (and the search embedder) run on AWS
only, or against a model server you run elsewhere
([below](#using-a-model-server-you-already-run)). Adding the pool means a `gpu` entry in that
cloud's cluster module and its `node_pools` output, as [extending](../extending.md#adding-a-cloud)
describes for the other pools.

## Precision: bf16 or float32

The model is trained in bf16. A short start script reads the GPU's compute capability and passes
`--dtype`:

| GPU | Compute capability | `--dtype` |
|---|---|---|
| L4, A10G, L40S, and newer | 8.0 or higher | `auto` (bf16) |
| T4 and older | below 8.0 | `float32` |

Never use fp16 (`half`) for this model: its activations overflow and it emits one token repeated
until `max_tokens` (seen as `locklocklock…`), so every page runs into the OCR client's timeout.
float32 fits a 1B model on a 16 GB T4 but generates more slowly than bf16.

vLLM is pinned to `v0.29.0`: `v0.30.0` fails to import this model's Pixtral rotary embedding with
the transformers it ships.

## Using a model server you already run

Leave `xyne-lighton-model` off and point the OCR service at any OpenAI-compatible endpoint serving
the same model:

```hcl
apps = {
  xyne-lighton-ocr = {
    enabled = true
    values  = <<-YAML
      env:
        LIGHTON_URL: https://ocr-model.internal.example.com/v1/chat/completions
    YAML
  }
}
```

## Check it works

A capped request straight to the model, from inside the OCR pod, shows whether the model reads
text or emits garbage:

```bash
kubectl -n xyne-apps exec deploy/xyne-lighton-ocr -- python3 -c '
import pymupdf,base64,httpx,os
d=pymupdf.open();p=d.new_page();p.insert_text((72,100),"Invoice INV-2026-0928, total 4,275.50",fontsize=16)
img=base64.b64encode(p.get_pixmap(dpi=150).tobytes("png")).decode()
r=httpx.post(os.environ["LIGHTON_URL"],timeout=90,json={"model":"lightonai/LightOnOCR-2-1B-bbox","max_tokens":200,"temperature":0,
 "messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,"+img}}]}]})
c=r.json()["choices"][0];print(c["finish_reason"],c["message"]["content"][:200])'
```

Expected: `stop` and the invoice text. `length` with repeated tokens means the precision is
wrong.

The full path, as the backend calls it (`POST /process` with a file and a `doc_id`):

```bash
kubectl -n xyne-apps exec deploy/xyne-lighton-ocr -- python3 -c '
import pymupdf,httpx
d=pymupdf.open();p=d.new_page();p.insert_text((72,100),"Invoice INV-2026-0928",fontsize=16)
r=httpx.post("http://localhost:8000/process",files={"file":("page.pdf",d.tobytes(),"application/pdf")},data={"doc_id":"check"},timeout=200)
print(r.status_code,[c.get("text","")[:80] for c in r.json()["chunks"]])'
```

The model server logs its choice at start:
`kubectl -n xyne-apps logs deploy/xyne-lighton-model | grep 'serving with --dtype'`.
