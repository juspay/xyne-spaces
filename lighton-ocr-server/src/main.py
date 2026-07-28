"""FastAPI entrypoint for the LightOn OCR service."""

from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from async_jobs import async_job_runner
from chunking import MarkdownTokenChunker
from config import settings
from job_tracker import tracker
from lighton_client import LightOnClient, LightOnClientConfig
from processor import OcrProcessor
from renderer import is_supported_upload
from runtime_config import (
    current_submit_permits,
    current_wrapper_async_max_inflight,
    current_wrapper_lighton_concurrency,
    start_runtime_config_poller,
    stop_runtime_config_poller,
)
from tokenization import OffsetTokenizer

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.processor = None
    app.state.lighton_client = None
    logger.info(
        "[startup] lighton_url=%s lighton_model=%s redis_url=%s",
        settings.lighton_url or "(not set)", settings.lighton_model, settings.redis_url,
    )
    await start_runtime_config_poller()
    if settings.has_lighton_endpoint:
        lighton_client = LightOnClient(
            LightOnClientConfig(
                endpoint_url=settings.lighton_url,
                model=settings.lighton_model,
                token=settings.lighton_access_token,
                timeout_seconds=settings.lighton_timeout_seconds,
                max_output_tokens=settings.lighton_max_output_tokens,
                temperature=settings.lighton_temperature,
                concurrency=max(
                    settings.lighton_concurrency,
                    current_wrapper_lighton_concurrency(),
                ),
                retries=settings.lighton_retries,
                ssl_verify=settings.lighton_ssl_verify,
                image_max_dim=settings.image_max_dim,
                jpeg_quality=settings.jpeg_quality,
            ),
            concurrency_provider=current_wrapper_lighton_concurrency,
        )
        tokenizer = OffsetTokenizer(settings.tokenizer_path)
        chunker = MarkdownTokenChunker(
            tokenizer,
            max_tokens=settings.max_tokens,
            overlap_tokens=settings.chunk_overlap_tokens,
        )
        app.state.lighton_client = lighton_client
        app.state.processor = OcrProcessor(
            settings=settings,
            lighton_client=lighton_client,
            chunker=chunker,
            lighton_concurrency_provider=current_wrapper_lighton_concurrency,
        )
        app.state.tokenizer_backend = tokenizer.backend
        logger.info("[startup] processor ready tokenizer_backend=%s", tokenizer.backend)
    else:
        logger.warning("[startup] LIGHTON_URL not set — processor disabled, /process will return 503")
    yield
    client = getattr(app.state, "lighton_client", None)
    if client is not None:
        await client.close()
    await stop_runtime_config_poller()


app = FastAPI(title="LightOn OCR Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict[str, object]:
    if not getattr(app.state, "processor", None):
        raise HTTPException(status_code=503, detail="LightOn OCR client is not configured")
    return {
        "status": "ok",
        "models_loaded": True,
        "tokenizer_backend": getattr(app.state, "tokenizer_backend", None),
    }


@app.post("/process")
async def process_document_endpoint(
    file: Annotated[UploadFile, File()],
    doc_id: Annotated[str, Form()],
) -> JSONResponse:
    _ensure_supported_file(file)
    processor = _processor_or_503()
    doc_id = _required_form_value(doc_id, "doc_id")
    logger.info("[/process] received doc_id=%s filename=%s content_type=%s", doc_id, file.filename, file.content_type)

    tmp_path = await _write_upload_to_temp(file)
    tracker.start(doc_id, filename=file.filename, mode="sync")
    try:
        result = await processor.process_document(
            tmp_path,
            filename=file.filename or Path(tmp_path).name,
            doc_id=doc_id,
            set_stage=tracker.stage_setter(doc_id),
        )
        tracker.done(doc_id)
        logger.info("[/process] done doc_id=%s chunks=%d", doc_id, len(result.get("chunks", [])))
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[/process] failed doc_id=%s filename=%s error=%s", doc_id, file.filename, exc)
        tracker.fail(doc_id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        _remove_file(tmp_path)


@app.post("/process_async", status_code=202)
async def process_document_async_endpoint(
    file: Annotated[UploadFile, File()],
    job_id: Annotated[str, Form()],
    file_id: Annotated[str, Form()],
    doc_id: Annotated[str, Form()],
    vespa_doc_id: Annotated[Optional[str], Form()] = None,  # noqa: UP045
) -> JSONResponse:
    _ensure_supported_file(file)
    _processor_or_503()
    job_id = _required_form_value(job_id, "job_id")
    file_id = _required_form_value(file_id, "file_id")
    doc_id = _required_form_value(doc_id, "doc_id")
    vespa_doc_id = (vespa_doc_id or "").strip() or None
    logger.info(
        "[/process_async] received job_id=%s file_id=%s doc_id=%s vespa_doc_id=%s filename=%s",
        job_id, file_id, doc_id, vespa_doc_id, file.filename,
    )

    submit = await async_job_runner.submit_upload(
        upload_file=file,
        job_id=job_id,
        file_id=file_id,
        doc_id=doc_id,
        vespa_doc_id=vespa_doc_id,
        app_state=app.state,
    )
    if submit.busy:
        logger.warning("[/process_async] rejected job_id=%s reason=%s", job_id, submit.message)
        raise HTTPException(
            status_code=429,
            detail=submit.message,
            headers={"Retry-After": str(submit.retry_after_seconds)},
        )
    if submit.duplicate:
        logger.info("[/process_async] duplicate job_id=%s", job_id)
    else:
        logger.info("[/process_async] accepted job_id=%s doc_id=%s", job_id, doc_id)
    return JSONResponse(
        status_code=202,
        content={
            "status": "accepted",
            "job_id": job_id,
            "doc_id": doc_id,
            "file_id": file_id,
        },
    )


@app.get("/status")
async def get_all_status() -> dict[str, dict[str, Any]]:
    return tracker.all()


@app.get("/status/{identifier}")
async def get_status(identifier: str) -> dict[str, Any]:
    entry = tracker.find(identifier)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No job found for '{identifier}'")
    return entry


@app.get("/instance_status")
async def instance_status() -> dict[str, object]:
    active = await async_job_runner.active_count()
    configured = current_wrapper_async_max_inflight()
    return {
        "active_instances": active,
        "configured_instances": configured,
        "idle_instances": max(configured - active, 0),
        "global_admission_enabled": settings.global_admission_enabled,
        "global_max_inflight": current_submit_permits(),
        "lighton_concurrency": current_wrapper_lighton_concurrency(),
    }


def _processor_or_503() -> OcrProcessor:
    processor = getattr(app.state, "processor", None)
    if processor is None:
        raise HTTPException(status_code=503, detail="LightOn OCR client is not configured")
    return processor


def _ensure_supported_file(upload: UploadFile) -> None:
    if not is_supported_upload(upload.filename or ""):
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX, PPTX, TXT, and image files are accepted",
        )


def _required_form_value(value: str, name: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{name} is required")
    return cleaned


async def _write_upload_to_temp(upload_file: UploadFile) -> str:
    suffix = Path(upload_file.filename or "").suffix or ".bin"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        out = os.fdopen(fd, "wb")
    except Exception:
        os.close(fd)
        _remove_file(tmp_path)
        raise
    try:
        with out:
            while True:
                chunk = await upload_file.read(settings.upload_chunk_size)
                if not chunk:
                    break
                out.write(chunk)
        return tmp_path
    except Exception:
        _remove_file(tmp_path)
        raise


def _remove_file(path: str) -> None:
    with suppress(OSError):
        Path(path).unlink()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
