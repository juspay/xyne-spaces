"""Async upload admission and Redis publication for OCR jobs."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from config import settings
from global_admission import RedisGlobalAdmission
from job_tracker import JobTracker, tracker as default_tracker
from redis_events import RedisResultPublisher, compact_error, publisher as default_publisher
from runtime_config import (
    current_submit_permits,
    current_wrapper_async_max_inflight,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable

    from fastapi import UploadFile


@dataclass(frozen=True)
class AsyncSubmitResult:
    accepted: bool
    duplicate: bool = False
    busy: bool = False
    message: str | None = None
    retry_after_seconds: int = settings.async_retry_after_seconds


class AsyncOcrJobRunner:
    def __init__(
        self,
        *,
        publisher: RedisResultPublisher = default_publisher,
        tracker: JobTracker = default_tracker,
        max_inflight: int = settings.async_max_inflight,
        max_inflight_provider: Callable[[], int] | None = None,
        job_ttl_seconds: int = settings.async_job_ttl_seconds,
        processor_func: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        global_admission: RedisGlobalAdmission | None = None,
    ) -> None:
        self.publisher = publisher
        self.tracker = tracker
        self.max_inflight = max(1, max_inflight)
        self.max_inflight_provider = max_inflight_provider
        self.job_ttl_seconds = job_ttl_seconds
        self.processor_func = processor_func
        if global_admission is not None:
            self.global_admission = global_admission
        elif settings.global_admission_enabled:
            self.global_admission = RedisGlobalAdmission(
                capacity_provider=current_submit_permits,
            )
        else:
            self.global_admission = None
        self._lock = asyncio.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._active_job_ids: set[str] = set()

    async def submit_upload(
        self,
        *,
        upload_file: UploadFile,
        job_id: str,
        file_id: str,
        doc_id: str,
        vespa_doc_id: str | None,
        app_state: Any,
    ) -> AsyncSubmitResult:
        reserve = await self._reserve(
            job_id=job_id,
            file_id=file_id,
            doc_id=doc_id,
            vespa_doc_id=vespa_doc_id,
        )
        if not reserve.accepted or reserve.duplicate:
            return reserve

        tmp_path: str | None = None
        result_key = self.publisher.result_key(job_id)
        self.tracker.start(
            doc_id,
            filename=upload_file.filename,
            mode="async",
            job_id=job_id,
            file_id=file_id,
            vespa_doc_id=vespa_doc_id,
            result_key=result_key,
        )
        self.tracker.set_stage(doc_id, "upload_staging")
        try:
            tmp_path = await self._write_upload_to_temp(upload_file)
            self.tracker.set_stage(doc_id, "queued")
            task = asyncio.create_task(
                self._run_job(
                    tmp_path=tmp_path,
                    filename=upload_file.filename or Path(tmp_path).name,
                    job_id=job_id,
                    file_id=file_id,
                    doc_id=doc_id,
                    vespa_doc_id=vespa_doc_id,
                    app_state=app_state,
                )
            )
            await self._set_task(job_id, task)
            return reserve
        except Exception:
            if tmp_path:
                _remove_file(tmp_path)
            self.tracker.fail(doc_id, "failed to accept upload")
            await self._mark_failed(job_id, "failed to accept upload")
            raise

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        async with self._lock:
            self._prune_locked()
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return {key: value for key, value in job.items() if key != "task"}

    async def active_count(self) -> int:
        async with self._lock:
            self._prune_locked()
            return len(self._active_job_ids)

    async def _reserve(
        self,
        *,
        job_id: str,
        file_id: str,
        doc_id: str,
        vespa_doc_id: str | None,
    ) -> AsyncSubmitResult:
        async with self._lock:
            self._prune_locked()
            existing = self._jobs.get(job_id)
            if existing and existing.get("state") in {"running", "done"}:
                return AsyncSubmitResult(accepted=True, duplicate=True)
            if len(self._active_job_ids) >= self._current_max_inflight():
                return AsyncSubmitResult(
                    accepted=False,
                    busy=True,
                    message="Too many async OCR jobs in flight",
                )

        global_permit = False
        if self.global_admission is not None:
            global_result = await self.global_admission.acquire(
                job_id=job_id,
                file_id=file_id,
                doc_id=doc_id,
                vespa_doc_id=vespa_doc_id,
            )
            if not global_result.accepted:
                return AsyncSubmitResult(
                    accepted=False,
                    busy=True,
                    message="Too many async OCR jobs in flight",
                    retry_after_seconds=global_result.retry_after_seconds,
                )
            if global_result.duplicate:
                # Redis only tells us that some OCR instance owns this job.
                # Behind a load balancer, accepting a duplicate on a different
                # instance would make the caller wait for a result this process
                # will never publish.
                async with self._lock:
                    self._prune_locked()
                    existing = self._jobs.get(job_id)
                    if existing and existing.get("state") in {"running", "done"}:
                        return AsyncSubmitResult(accepted=True, duplicate=True)
                return AsyncSubmitResult(
                    accepted=False,
                    busy=True,
                    message="Async OCR job is already in flight on another instance",
                    retry_after_seconds=global_result.retry_after_seconds,
                )
            global_permit = True

        release_global = False
        reserve_result: AsyncSubmitResult | None = None
        async with self._lock:
            self._prune_locked()
            existing = self._jobs.get(job_id)
            if existing and existing.get("state") in {"running", "done"}:
                release_global = global_permit
                reserve_result = AsyncSubmitResult(accepted=True, duplicate=True)
            elif len(self._active_job_ids) >= self._current_max_inflight():
                release_global = global_permit
                reserve_result = AsyncSubmitResult(
                    accepted=False,
                    busy=True,
                    message="Too many async OCR jobs in flight",
                )
            else:
                self._jobs[job_id] = {
                    "job_id": job_id,
                    "state": "running",
                    "started_at": time.time(),
                    "completed_at": None,
                    "error": None,
                    "global_permit": global_permit,
                }
                self._active_job_ids.add(job_id)
                return AsyncSubmitResult(accepted=True)

        if release_global and self.global_admission is not None:
            await self.global_admission.release(job_id)
        return reserve_result or AsyncSubmitResult(
            accepted=False,
            busy=True,
            message="Too many async OCR jobs in flight",
        )

    async def _set_task(self, job_id: str, task: asyncio.Task) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job["task"] = task

    async def _run_job(
        self,
        *,
        tmp_path: str,
        filename: str,
        job_id: str,
        file_id: str,
        doc_id: str,
        vespa_doc_id: str | None,
        app_state: Any,
    ) -> None:
        try:
            result = await self._call_processor(tmp_path, filename, doc_id, app_state)
            self.tracker.set_stage(doc_id, "redis_store")
            result_key = await self.publisher.store_result(job_id, result)
            self.tracker.update(doc_id, result_key=result_key)

            self.tracker.set_stage(doc_id, "redis_publish")
            event_id = await self.publisher.publish_success(
                job_id=job_id,
                file_id=file_id,
                doc_id=doc_id,
                vespa_doc_id=vespa_doc_id,
                result_key=result_key,
            )
            self.tracker.update(
                doc_id,
                published_at=time.time(),
                redis_event_id=_event_id_to_str(event_id),
            )
            self.tracker.done(doc_id)
            await self._mark_done(job_id)
        except Exception as exc:
            error = compact_error(exc)
            try:
                self.tracker.set_stage(doc_id, "redis_failure_publish")
                event_id = await self.publisher.publish_failure(
                    job_id=job_id,
                    file_id=file_id,
                    doc_id=doc_id,
                    vespa_doc_id=vespa_doc_id,
                    error=error,
                )
                self.tracker.update(
                    doc_id,
                    published_at=time.time(),
                    redis_event_id=_event_id_to_str(event_id),
                )
            except Exception as publish_exc:
                error = compact_error(
                    f"{error}; failed to publish failure event: {publish_exc}",
                    max_length=768,
                )
            self.tracker.fail(doc_id, error)
            await self._mark_failed(job_id, error)
        finally:
            _remove_file(tmp_path)

    async def _call_processor(
        self,
        tmp_path: str,
        filename: str,
        doc_id: str,
        app_state: Any,
    ) -> dict[str, Any]:
        processor = self.processor_func
        if processor is None:
            processor = app_state.processor.process_document
        result = processor(
            tmp_path,
            filename=filename,
            doc_id=doc_id,
            set_stage=self.tracker.stage_setter(doc_id),
        )
        if inspect.isawaitable(result):
            return await result
        return result

    async def _mark_done(self, job_id: str) -> None:
        release_global = False
        async with self._lock:
            job = self._jobs.setdefault(job_id, {"job_id": job_id})
            job["state"] = "done"
            job["completed_at"] = time.time()
            job["error"] = None
            self._active_job_ids.discard(job_id)
            release_global = bool(job.get("global_permit"))
            job["global_permit"] = False
        if release_global and self.global_admission is not None:
            await self.global_admission.release(job_id)

    async def _mark_failed(self, job_id: str, error: str) -> None:
        release_global = False
        async with self._lock:
            job = self._jobs.setdefault(job_id, {"job_id": job_id})
            job["state"] = "failed"
            job["completed_at"] = time.time()
            job["error"] = error
            self._active_job_ids.discard(job_id)
            release_global = bool(job.get("global_permit"))
            job["global_permit"] = False
        if release_global and self.global_admission is not None:
            await self.global_admission.release(job_id)

    async def _write_upload_to_temp(self, upload_file: UploadFile) -> str:
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

    def _prune_locked(self) -> None:
        cutoff = time.time() - self.job_ttl_seconds
        for job_id in [
            job_id
            for job_id, job in self._jobs.items()
            if job.get("completed_at") is not None and job["completed_at"] < cutoff
        ]:
            self._jobs.pop(job_id, None)
            self._active_job_ids.discard(job_id)

    def _current_max_inflight(self) -> int:
        if self.max_inflight_provider is None:
            return self.max_inflight
        try:
            return max(1, int(self.max_inflight_provider()))
        except Exception:
            return self.max_inflight


def _remove_file(path: str) -> None:
    with contextlib.suppress(OSError):
        Path(path).unlink()


def _event_id_to_str(event_id: Any) -> str:
    if isinstance(event_id, bytes):
        return event_id.decode("utf-8", errors="replace")
    return str(event_id)


async_job_runner = AsyncOcrJobRunner(
    max_inflight_provider=current_wrapper_async_max_inflight,
)
