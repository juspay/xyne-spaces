"""In-memory status tracker for sync and async OCR jobs."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from config import settings


class JobTracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def start(self, doc_id: str, filename: str | None = None, **metadata: Any) -> None:
        with self._lock:
            self._prune_locked()
            entry = {
                "doc_id": doc_id,
                "filename": filename,
                "state": "running",
                "stage": None,
                "started_at": time.time(),
                "completed_at": None,
                "duration_seconds": None,
                "error": None,
            }
            entry.update({key: value for key, value in metadata.items() if value is not None})
            self._jobs[doc_id] = entry

    def set_stage(self, doc_id: str, stage: str) -> None:
        with self._lock:
            entry = self._jobs.get(doc_id)
            if entry is not None:
                entry["stage"] = stage

    def update(self, doc_id: str, **fields: Any) -> None:
        with self._lock:
            entry = self._jobs.get(doc_id)
            if entry is not None:
                entry.update({key: value for key, value in fields.items() if value is not None})

    def stage_setter(self, doc_id: str) -> Callable[[str], None]:
        def _set(stage: str) -> None:
            self.set_stage(doc_id, stage)

        return _set

    def done(self, doc_id: str) -> None:
        self._finish(doc_id, "done", None)

    def fail(self, doc_id: str, error: str) -> None:
        self._finish(doc_id, "failed", error)

    def find(self, identifier: str) -> dict[str, Any] | None:
        with self._lock:
            self._prune_locked()
            entry = self._jobs.get(identifier)
            if entry is not None:
                return dict(entry)
            matches = [
                job
                for job in self._jobs.values()
                if job.get("filename") == identifier or job.get("job_id") == identifier
            ]
            if not matches:
                return None
            return dict(max(matches, key=lambda job: job.get("started_at") or 0))

    def all(self) -> dict[str, Any]:
        with self._lock:
            self._prune_locked()
            jobs = sorted(
                (dict(job) for job in self._jobs.values()),
                key=lambda job: job.get("started_at") or 0,
                reverse=True,
            )
        counts = {"running": 0, "done": 0, "failed": 0}
        for job in jobs:
            state = job.get("state")
            if state in counts:
                counts[state] += 1
        counts["total"] = len(jobs)
        return {"counts": counts, "jobs": jobs}

    def _finish(self, doc_id: str, state: str, error: str | None) -> None:
        with self._lock:
            entry = self._jobs.setdefault(doc_id, {"doc_id": doc_id, "started_at": time.time()})
            now = time.time()
            entry["state"] = state
            entry["completed_at"] = now
            entry["duration_seconds"] = round(now - entry.get("started_at", now), 3)
            entry["error"] = error

    def _prune_locked(self) -> None:
        cutoff = time.time() - settings.status_ttl_seconds
        for doc_id in [
            key
            for key, entry in self._jobs.items()
            if entry.get("completed_at") is not None and entry["completed_at"] < cutoff
        ]:
            self._jobs.pop(doc_id, None)


tracker = JobTracker()
