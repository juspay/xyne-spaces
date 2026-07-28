# LightOn OCR Service

CPU-only OCR wrapper backed by an external LightOnOCR bbox model served through an OpenAI-compatible `/v1/chat/completions` API.

The service keeps the current Docling-style response envelope and strict chunk objects:

```json
{
  "text": "...",
  "headings": ["Section"],
  "page_numbers": [1],
  "bbox": null
}
```

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Ready when `LIGHTON_URL` is configured |
| `POST /process` | Sync document/image OCR |
| `POST /process_async` | Async document/image OCR with Redis result publication |
| `GET /status` | In-memory job status snapshot |
| `GET /status/{identifier}` | Lookup by doc id, filename, or job id |
| `GET /instance_status` | Local instance capacity snapshot |

## Flow

- Accept `.pdf`, `.docx`, `.pptx`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.bmp`, `.webp`, `.tif`, and `.tiff`.
- Rasterize PDFs/images locally with PyMuPDF/Pillow. DOCX/PPTX are converted to PDF with headless LibreOffice first; TXT is rendered into wrapped image pages with Pillow. No GPU is required in this service.
- Send rendered pages to LightOn as OpenAI-compatible chat-completion image requests.
- Parse LightOn bbox markers in the documented `![image](image_N.png)x1,y1,x2,y2` format, normalized to `0..1000`.
- Cap parsed bbox regions before merge with `LIGHTON_MAX_IMAGE_REGIONS_PER_PAGE` to bound worst-case page work.
- Merge overlapping bbox regions and send only the merged crop back to LightOn.
- Limit crop recursion to depth 1: page OCR can trigger crop OCR, crop OCR cannot trigger more crops.
- Strip raw bbox image markers before chunking.
- Bundle only the E5 tokenizer in the image at `E5_TOKENIZER_PATH`; chunk each page's markdown with `MAX_TOKENS=460` and `CHUNK_OVERLAP_TOKENS=12`.

## Image Contents

The Docker image is self-contained for the LightOn OCR module:

- LightOn OCR inference is external through `LIGHTON_URL`.
- The E5 tokenizer files are baked into `/app/e5-tokenizer`.
- No full E5 embedder, Torch, or GPU runtime is required.

## Async Redis

`POST /process_async` stores the full result at:

```text
<OCR_RESULT_KEY_PREFIX>:<job_id>
```

and publishes a small event to `OCR_RESULTS_STREAM`:

```text
job_id <job_id> file_id <file_id> doc_id <doc_id> status ok result_key <key>
```

Defaults use the existing Docling Redis names (`docling:results`, `docling:result`) so the current consumer can keep listening on the same stream. Override `OCR_RESULTS_STREAM` and `OCR_RESULT_KEY_PREFIX` only if you want to separate this service from Docling.

Set `OCR_ASYNC_GLOBAL_MAX_INFLIGHT` to a positive value to enforce fleet-wide Redis admission across all service replicas. Set it to `-1` to disable the global cap.

## Run

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:8002/health
```

Sync:

```bash
curl -X POST http://localhost:8002/process \
  -F "file=@document.pdf" \
  -F "doc_id=doc-123"
```

Async:

```bash
curl -X POST http://localhost:8002/process_async \
  -F "file=@document.pdf" \
  -F "job_id=job-123" \
  -F "file_id=file-123" \
  -F "doc_id=doc-123"
```

## Development

```bash
python -m pip install -r requirements.txt -r requirements-dev.txt
make lint
make test
```

Use `make PYTHON=.venv/bin/python lint` when the virtualenv is not activated.
