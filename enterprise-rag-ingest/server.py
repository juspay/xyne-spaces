#!/usr/bin/env python3
"""Local dashboard that sends EnterpriseRAG-Bench rows through the Xyne backend."""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

import pyarrow.parquet as pq


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
STATE_PATH = BASE_DIR / "progress.json"
HOST = os.environ.get("INGEST_HOST", "127.0.0.1")
PORT = int(os.environ.get("INGEST_PORT", "8090"))
PARQUET_PATH = Path(
    os.environ.get(
        "ENTERPRISE_RAG_PARQUET",
        str(Path.home() / "Downloads/EnterpriseRAG-Bench/documents/test.parquet"),
    )
).expanduser()
XYNE_BACKEND_URL = os.environ.get("XYNE_BACKEND_URL", "http://127.0.0.1:3001").rstrip("/")
XYNE_API_TOKEN = os.environ.get("XYNE_API_TOKEN", "")
XYNE_WORKSPACE_ID = os.environ.get("XYNE_WORKSPACE_ID") or f"enterprise-rag-{uuid.uuid4().hex[:12]}"
XYNE_ORG_ID = os.environ.get("XYNE_ORG_ID") or f"{XYNE_WORKSPACE_ID}-org"
XYNE_USER_ID = os.environ.get("XYNE_USER_ID") or f"{XYNE_WORKSPACE_ID}-user"
XYNE_USER_NAME = os.environ.get("XYNE_USER_NAME", "EnterpriseRAG Admin")
XYNE_USER_EMAIL = os.environ.get("XYNE_USER_EMAIL", "enterprise-rag@example.com")
VESPA_DOCUMENT_URL = os.environ.get("VESPA_DOCUMENT_URL", "http://127.0.0.1:8080").rstrip("/")
VESPA_CLUSTER = os.environ.get("VESPA_CLUSTER", "my_content")
VESPA_NAMESPACE = os.environ.get("VESPA_NAMESPACE", "default")
VESPA_SCHEMAS = ("chat_message", "file", "mail", "ticket", "sam_transcript")
DATASET_COLUMNS = ["doc_id", "source_type", "title", "content"]


def dataset_row_count() -> int:
    if not PARQUET_PATH.is_file():
        return 0
    return pq.ParquetFile(PARQUET_PATH).metadata.num_rows


class DatasetSummary:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._value: dict[str, Any] | None = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            if self._value is not None:
                return self._value
            counts: Counter[str] = Counter()
            ranges: dict[str, dict[str, int]] = {}
            row_index = 0
            if PARQUET_PATH.is_file():
                parquet = pq.ParquetFile(PARQUET_PATH)
                for batch in parquet.iter_batches(batch_size=65_536, columns=["source_type"]):
                    for value in batch.column(0).to_pylist():
                        if value:
                            source_type = str(value)
                            counts[source_type] += 1
                            bounds = ranges.setdefault(
                                source_type,
                                {"start_row": row_index, "end_row": row_index},
                            )
                            bounds["end_row"] = row_index
                        row_index += 1
            self._value = {
                "total": sum(counts.values()),
                "by_source_type": dict(sorted(counts.items())),
                "source_ranges": dict(sorted(ranges.items())),
            }
            return self._value


def read_row(row_index: int) -> dict[str, Any]:
    if row_index < 0:
        raise ValueError("row_index must be non-negative")
    if not PARQUET_PATH.is_file():
        raise FileNotFoundError(f"Parquet file not found: {PARQUET_PATH}")

    parquet = pq.ParquetFile(PARQUET_PATH)
    if row_index >= parquet.metadata.num_rows:
        raise IndexError(
            f"row_index {row_index} is outside the dataset ({parquet.metadata.num_rows} rows)"
        )

    remaining = row_index
    for group_index in range(parquet.num_row_groups):
        group_rows = parquet.metadata.row_group(group_index).num_rows
        if remaining < group_rows:
            table = parquet.read_row_group(group_index, columns=DATASET_COLUMNS)
            return table.slice(remaining, 1).to_pylist()[0]
        remaining -= group_rows

    raise IndexError(f"Could not locate row_index {row_index}")


def iter_rows(start_row: int, end_row: int, batch_size: int = 64) -> Iterator[tuple[int, dict[str, Any]]]:
    """Read a row range efficiently without decompressing a row group per row."""
    parquet = pq.ParquetFile(PARQUET_PATH)
    group_start = 0
    for group_index in range(parquet.num_row_groups):
        group_rows = parquet.metadata.row_group(group_index).num_rows
        group_end = group_start + group_rows
        if group_end <= start_row:
            group_start = group_end
            continue
        if group_start >= end_row:
            return

        group_offset = 0
        batches = parquet.iter_batches(
            batch_size=batch_size,
            row_groups=[group_index],
            columns=DATASET_COLUMNS,
        )
        for batch in batches:
            batch_start = group_start + group_offset
            batch_end = batch_start + batch.num_rows
            group_offset += batch.num_rows
            if batch_end <= start_row:
                continue
            if batch_start >= end_row:
                return

            local_start = max(0, start_row - batch_start)
            local_end = min(batch.num_rows, end_row - batch_start)
            rows = batch.slice(local_start, local_end - local_start).to_pylist()
            for offset, row in enumerate(rows):
                yield batch_start + local_start + offset, row

        group_start = group_end


def backend_headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Workspace-Id": XYNE_WORKSPACE_ID,
        "X-Benchmark-Org-Id": XYNE_ORG_ID,
        "X-Benchmark-User-Id": XYNE_USER_ID,
        "X-User-Name": XYNE_USER_NAME,
        "X-User-Email": XYNE_USER_EMAIL,
    }
    if XYNE_API_TOKEN:
        headers["Authorization"] = f"Bearer {XYNE_API_TOKEN}"
    return headers


def backend_request(path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    request = Request(
        f"{XYNE_BACKEND_URL}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers=backend_headers(),
        method=method,
    )
    try:
        with urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Backend returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Cannot reach Xyne backend at {XYNE_BACKEND_URL}: {exc.reason}") from exc


def vespa_request(path: str, query: dict[str, str | int] | None = None) -> dict[str, Any]:
    suffix = f"?{urlencode(query)}" if query else ""
    request = Request(f"{VESPA_DOCUMENT_URL}{path}{suffix}", method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Vespa returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Cannot reach Vespa at {VESPA_DOCUMENT_URL}: {exc.reason}") from exc


def validate_schema(schema: str) -> str:
    if schema not in VESPA_SCHEMAS:
        raise ValueError(f"schema must be one of: {', '.join(VESPA_SCHEMAS)}")
    return schema


def parse_metadata(fields: dict[str, Any]) -> dict[str, Any]:
    metadata = fields.get("metadata")
    if not isinstance(metadata, str):
        return {}
    try:
        value = json.loads(metadata)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def document_summary(schema: str, document: dict[str, Any]) -> dict[str, Any]:
    fields = document.get("fields") if isinstance(document.get("fields"), dict) else {}
    metadata = parse_metadata(fields)
    chunks = fields.get("chunks") if isinstance(fields.get("chunks"), list) else []
    text = str(fields.get("text") or fields.get("description") or (chunks[0] if chunks else ""))
    title = str(
        fields.get("fileName")
        or fields.get("subject")
        or fields.get("title")
        or fields.get("name")
        or fields.get("messageChannelName")
        or fields.get("username")
        or fields.get("docId")
        or "Untitled"
    )
    full_id = str(document.get("id") or "")
    doc_id = str(fields.get("docId") or full_id.rsplit("::", 1)[-1])
    return {
        "id": full_id,
        "doc_id": doc_id,
        "schema": schema,
        "title": title,
        "preview": text[:320],
        "chunk_count": len(chunks),
        "source_type": metadata.get("benchmarkSourceType"),
        "row_index": metadata.get("benchmarkRow"),
        "username": fields.get("username"),
        "created_at": fields.get("createdAt") or fields.get("createdAtTimestamp"),
    }


def list_vespa_documents(schema: str, limit: int, continuation: str = "") -> dict[str, Any]:
    schema = validate_schema(schema)
    limit = max(1, min(limit, 50))
    query: dict[str, str | int] = {
        "cluster": VESPA_CLUSTER,
        "wantedDocumentCount": limit,
    }
    if continuation:
        query["continuation"] = continuation
    body = vespa_request(f"/document/v1/{VESPA_NAMESPACE}/{schema}/docid/", query)
    if body.get("message") and not body.get("documents"):
        raise RuntimeError(str(body["message"]))
    documents = body.get("documents") if isinstance(body.get("documents"), list) else []
    return {
        "schema": schema,
        "documents": [document_summary(schema, document) for document in documents],
        "document_count": int(body.get("documentCount") or len(documents)),
        "continuation": body.get("continuation"),
    }


def get_vespa_document(schema: str, doc_id: str) -> dict[str, Any]:
    schema = validate_schema(schema)
    if not doc_id or len(doc_id) > 512:
        raise ValueError("doc_id is required and must be at most 512 characters")
    body = vespa_request(
        f"/document/v1/{VESPA_NAMESPACE}/{schema}/docid/{quote(doc_id, safe='')}"
    )
    fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
    return {
        "id": body.get("id"),
        "schema": schema,
        "doc_id": doc_id,
        "fields": fields,
        "chunk_count": len(fields.get("chunks", [])) if isinstance(fields.get("chunks"), list) else 0,
    }


def feed_row(row_index: int, row: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(row["doc_id"])
    title = str(row.get("title") or doc_id)
    source_type = str(row.get("source_type") or "unknown")
    content = str(row.get("content") or "")
    if not content.strip():
        raise ValueError(f"Document {doc_id} has empty content")
    backend_response = backend_request(
        "/api/admin/enterprise-rag/ingest",
        "POST",
        {
            "rowIndex": row_index,
            "docId": doc_id,
            "sourceType": source_type,
            "title": title,
            "content": content,
        },
    )
    return {
        "ok": True,
        "row_index": row_index,
        "doc_id": doc_id,
        "title": title,
        "source_type": source_type,
        "classification": backend_response["ingestionPath"],
        "ingestion_status": backend_response.get("status", "queued"),
        "schemas": backend_response.get("schemas", []),
        "entity_ids": backend_response.get("entityIds", []),
        "queue_jobs": len(backend_response.get("queueJobs", [])),
        "content_bytes": len(content.encode("utf-8")),
        "backend": backend_response,
    }


def feed_one(row_index: int) -> dict[str, Any]:
    return feed_row(row_index, read_row(row_index))


class BackendStats:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._value: dict[str, Any] | None = None
        self._checked_at = 0.0
        self._error: str | None = None

    def snapshot(self) -> tuple[dict[str, Any] | None, str | None]:
        with self._lock:
            if time.time() - self._checked_at < 3:
                return self._value, self._error
            try:
                body = backend_request("/api/admin/enterprise-rag/stats")
                self._value = {
                    "total": int(body.get("total", 0)),
                    "source_rows": int(body.get("sourceRows", body.get("total", 0))),
                    "by_schema": {
                        str(schema): int(count)
                        for schema, count in (body.get("bySchema") or {}).items()
                    },
                    "by_source": {
                        str(source): int(count)
                        for source, count in (body.get("bySource") or {}).items()
                    },
                }
                try:
                    queue_body = backend_request("/api/admin/enterprise-rag/queues")
                    self._value["queues"] = queue_body.get("queues") or {}
                    self._value["queue_error"] = None
                except Exception as queue_exc:
                    self._value["queues"] = {}
                    self._value["queue_error"] = str(queue_exc)
                context = backend_request("/api/admin/enterprise-rag/context")
                self._value["workspace_id"] = context.get("workspaceId")
                self._value["user_id"] = context.get("userId")
                self._error = None
            except Exception as exc:
                self._error = str(exc)
            self._checked_at = time.time()
            return self._value, self._error


class ProgressTracker:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_persisted_at = 0.0
        self._state = self._initial_state()
        self._load()

    @staticmethod
    def _initial_state() -> dict[str, Any]:
        return {
            "status": "idle",
            "start_row": 0,
            "end_row": 0,
            "requested": 0,
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "current_row": None,
            "last_document": None,
            "last_error": None,
            "recent_errors": [],
            "vespa_writes": 0,
            "queued": 0,
            "duplicates": 0,
            "classifications": {},
            "content_bytes": 0,
            "concurrency": 1,
            "source_type": None,
            "started_at": None,
            "finished_at": None,
            "updated_at": None,
        }

    def _load(self) -> None:
        if not STATE_PATH.is_file():
            return
        try:
            loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            self._state.update(loaded)
            if self._state["status"] in {"running", "stopping"}:
                self._state["status"] = "interrupted"
                self._state["finished_at"] = time.time()
            self._persist(force=True)
        except Exception as exc:
            print(f"Could not restore progress state: {exc}")

    def _persist(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_persisted_at < 1:
            return
        temporary = STATE_PATH.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(self._state, indent=2), encoding="utf-8")
        temporary.replace(STATE_PATH)
        self._last_persisted_at = now

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            state = dict(self._state)
            state["recent_errors"] = list(self._state["recent_errors"])

        now = state["finished_at"] or time.time()
        started_at = state["started_at"]
        elapsed = max(0.0, now - started_at) if started_at else 0.0
        rate = state["attempted"] / elapsed if elapsed > 0 else 0.0
        remaining = max(0, state["requested"] - state["attempted"])
        state["elapsed_seconds"] = elapsed
        state["rate_per_second"] = rate
        state["eta_seconds"] = remaining / rate if rate > 0 else None
        state["percentage"] = (
            state["attempted"] / state["requested"] * 100 if state["requested"] else 0.0
        )
        state["resume_row"] = (
            min(state["end_row"], state["start_row"] + state["attempted"])
            if state["requested"]
            else None
        )
        state["can_resume"] = bool(
            state["resume_row"] is not None
            and state["resume_row"] < state["end_row"]
            and state["status"] not in {"running", "stopping"}
        )
        state["dataset_rows"] = dataset_row_count()
        vespa_stats, vespa_error = VESPA_STATS.snapshot()
        state["workspace_id"] = (
            vespa_stats.get("workspace_id") if vespa_stats else XYNE_WORKSPACE_ID
        )
        state["vespa_documents"] = vespa_stats["total"] if vespa_stats else None
        state["vespa_source_rows"] = vespa_stats["source_rows"] if vespa_stats else None
        state["vespa_by_schema"] = vespa_stats["by_schema"] if vespa_stats else {}
        state["vespa_by_source"] = vespa_stats["by_source"] if vespa_stats else {}
        state["vespa_queues"] = vespa_stats.get("queues", {}) if vespa_stats else {}
        state["vespa_queue_error"] = vespa_stats.get("queue_error") if vespa_stats else None
        state["dataset_remaining"] = (
            max(0, state["dataset_rows"] - vespa_stats["source_rows"])
            if vespa_stats
            else None
        )
        if vespa_stats:
            progress_source = state.get("source_type")
            if progress_source:
                source_counts = DATASET_SUMMARY.snapshot()["by_source_type"]
                vespa_progress_total = int(source_counts.get(progress_source, 0))
                vespa_progress_indexed = int(
                    vespa_stats["by_source"].get(progress_source, 0)
                )
            else:
                vespa_progress_total = state["dataset_rows"]
                vespa_progress_indexed = int(vespa_stats["source_rows"])
            state["vespa_progress_source"] = progress_source
            state["vespa_progress_total"] = vespa_progress_total
            state["vespa_progress_indexed"] = vespa_progress_indexed
            state["vespa_progress_remaining"] = max(
                0, vespa_progress_total - vespa_progress_indexed
            )
            state["vespa_percentage"] = min(
                100.0,
                vespa_progress_indexed / vespa_progress_total * 100
                if vespa_progress_total
                else 0.0,
            )
        else:
            state["vespa_progress_source"] = state.get("source_type")
            state["vespa_progress_total"] = None
            state["vespa_progress_indexed"] = None
            state["vespa_progress_remaining"] = None
            state["vespa_percentage"] = None
        state["vespa_count_error"] = vespa_error
        return state

    def start(
        self,
        start_row: int,
        limit: int,
        concurrency: int,
        source_type: str | None = None,
    ) -> dict[str, Any]:
        try:
            backend_request("/api/admin/enterprise-rag/stats")
        except RuntimeError as exc:
            raise RuntimeError(f"Backend preflight failed: {exc}") from exc

        rows = dataset_row_count()
        if rows == 0:
            raise ValueError("The Parquet dataset is missing or empty")
        if start_row < 0 or start_row >= rows:
            raise ValueError(f"start_row must be between 0 and {rows - 1}")
        if limit < 1:
            raise ValueError("limit must be at least 1")
        if concurrency < 1 or concurrency > 8:
            raise ValueError("concurrency must be between 1 and 8")

        normalized_source = source_type.strip().lower() if source_type else None
        if normalized_source:
            source_range = DATASET_SUMMARY.snapshot()["source_ranges"].get(normalized_source)
            if not source_range:
                raise ValueError(f"Unknown source type: {normalized_source}")
            start_row = max(start_row, int(source_range["start_row"]))
            source_end = int(source_range["end_row"]) + 1
            if start_row >= source_end:
                raise ValueError(
                    f"start_row must be at most {source_end - 1} for {normalized_source}"
                )
            end_row = min(source_end, start_row + limit)
        else:
            end_row = min(rows, start_row + limit)
        with self._lock:
            if self._state["status"] in {"running", "stopping"}:
                raise RuntimeError("An ingestion run is already active")
            now = time.time()
            self._stop_event.clear()
            self._state = {
                **self._initial_state(),
                "status": "running",
                "start_row": start_row,
                "end_row": end_row,
                "requested": end_row - start_row,
                "concurrency": concurrency,
                "source_type": normalized_source,
                "started_at": now,
                "updated_at": now,
            }
            self._persist(force=True)
            self._thread = threading.Thread(
                target=self._run,
                args=(start_row, end_row, concurrency),
                name="enterprise-rag-batch",
                daemon=True,
            )
            self._thread.start()
        return self.snapshot()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._state["status"] == "running":
                self._state["status"] = "stopping"
                self._state["updated_at"] = time.time()
                self._stop_event.set()
                self._persist(force=True)
        return self.snapshot()

    def resume(self) -> dict[str, Any]:
        with self._lock:
            if self._state["status"] in {"running", "stopping"}:
                raise RuntimeError("An ingestion run is already active")
            start_row = int(self._state["start_row"]) + int(self._state["attempted"])
            end_row = int(self._state["end_row"])
            concurrency = int(self._state["concurrency"])
            source_type = self._state.get("source_type")
        if start_row >= end_row:
            raise RuntimeError("The previous submission range is already complete")
        return self.start(start_row, end_row - start_row, concurrency, source_type)

    @staticmethod
    def _safe_feed(row_index: int, row: dict[str, Any]) -> dict[str, Any]:
        try:
            return feed_row(row_index, row)
        except Exception as exc:
            return {
                "ok": False,
                "row_index": row_index,
                "doc_id": str(row.get("doc_id") or "unknown"),
                "title": str(row.get("title") or "Untitled"),
                "error": str(exc),
            }

    def _record(self, result: dict[str, Any]) -> None:
        with self._lock:
            self._state["attempted"] += 1
            self._state["current_row"] = result["row_index"]
            self._state["updated_at"] = time.time()
            if result["ok"]:
                self._state["succeeded"] += 1
                self._state["vespa_writes"] += int(result["queue_jobs"])
                ingestion_status = result["ingestion_status"]
                if ingestion_status == "duplicate":
                    self._state["duplicates"] += 1
                else:
                    self._state["queued"] += 1
                classification = result["classification"]
                counts = self._state["classifications"]
                counts[classification] = int(counts.get(classification, 0)) + 1
                self._state["content_bytes"] += int(result["content_bytes"])
                self._state["last_document"] = {
                    "row_index": result["row_index"],
                    "doc_id": result["doc_id"],
                    "title": result["title"],
                    "source_type": result["source_type"],
                    "classification": classification,
                    "ingestion_status": ingestion_status,
                    "schemas": result["schemas"],
                    "entity_ids": result["entity_ids"],
                }
            else:
                self._state["failed"] += 1
                error = {
                    "row_index": result["row_index"],
                    "doc_id": result["doc_id"],
                    "title": result["title"],
                    "error": result["error"],
                    "at": time.time(),
                }
                self._state["last_error"] = error
                self._state["recent_errors"] = ([error] + self._state["recent_errors"])[:20]
            self._persist()

    def _run(self, start_row: int, end_row: int, concurrency: int) -> None:
        row_iterator = iter_rows(start_row, end_row)
        pending: dict[Future[dict[str, Any]], int] = {}

        try:
            with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="vespa-feed") as executor:
                while not self._stop_event.is_set() and len(pending) < concurrency * 2:
                    try:
                        row_index, row = next(row_iterator)
                    except StopIteration:
                        break
                    pending[executor.submit(self._safe_feed, row_index, row)] = row_index

                while pending:
                    completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for future in completed:
                        pending.pop(future, None)
                        self._record(future.result())

                    while not self._stop_event.is_set() and len(pending) < concurrency * 2:
                        try:
                            row_index, row = next(row_iterator)
                        except StopIteration:
                            break
                        pending[executor.submit(self._safe_feed, row_index, row)] = row_index

            with self._lock:
                self._state["status"] = "stopped" if self._stop_event.is_set() else "completed"
                self._state["finished_at"] = time.time()
                self._state["updated_at"] = self._state["finished_at"]
                self._persist(force=True)
        except Exception as exc:
            with self._lock:
                self._state["status"] = "failed"
                self._state["last_error"] = {
                    "row_index": self._state["current_row"],
                    "doc_id": "batch",
                    "title": "Batch reader",
                    "error": str(exc),
                    "at": time.time(),
                }
                self._state["finished_at"] = time.time()
                self._state["updated_at"] = self._state["finished_at"]
                self._persist(force=True)


DATASET_SUMMARY = DatasetSummary()
VESPA_STATS = BackendStats()
PROGRESS = ProgressTracker()


class Handler(BaseHTTPRequestHandler):
    server_version = "EnterpriseRAGIngest/0.2"

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self.send_json(404, {"error": "not found"})
            return
        encoded = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > 4096:
            raise ValueError("request body is too large")
        raw = self.rfile.read(content_length) if content_length else b"{}"
        body = json.loads(raw.decode("utf-8"))
        if not isinstance(body, dict):
            raise ValueError("request body must be a JSON object")
        return body

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        try:
            if path == "/":
                self.send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            elif path == "/api/status":
                self.send_json(200, PROGRESS.snapshot())
            elif path == "/api/dataset-summary":
                self.send_json(200, DATASET_SUMMARY.snapshot())
            elif path == "/api/documents":
                self.send_json(
                    200,
                    list_vespa_documents(
                        str(query.get("schema", ["file"])[0]),
                        int(query.get("limit", ["20"])[0]),
                        str(query.get("continuation", [""])[0]),
                    ),
                )
            elif path == "/api/document":
                self.send_json(
                    200,
                    get_vespa_document(
                        str(query.get("schema", ["file"])[0]),
                        str(query.get("doc_id", [""])[0]),
                    ),
                )
            elif path == "/health":
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "parquet_path": str(PARQUET_PATH),
                        "parquet_exists": PARQUET_PATH.is_file(),
                        "dataset_rows": dataset_row_count(),
                        "xyne_backend_url": XYNE_BACKEND_URL,
                        "vespa_document_url": VESPA_DOCUMENT_URL,
                        "token_configured": bool(XYNE_API_TOKEN),
                        "workspace_id": XYNE_WORKSPACE_ID,
                    },
                )
            else:
                self.send_json(404, {"error": "not found"})
        except (ValueError, TypeError) as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except RuntimeError as exc:
            self.send_json(502, {"ok": False, "error": str(exc)})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path == "/api/start":
                state = PROGRESS.start(
                    int(body.get("start_row", 0)),
                    int(body.get("limit", 100)),
                    int(body.get("concurrency", 2)),
                    str(body.get("source_type") or "") or None,
                )
                self.send_json(202, state)
            elif path == "/api/stop":
                self.send_json(202, PROGRESS.stop())
            elif path == "/api/resume":
                self.send_json(202, PROGRESS.resume())
            elif path == "/ingest-one":
                self.send_json(200, feed_one(int(body.get("row_index", 0))))
            else:
                self.send_json(404, {"error": "not found"})
        except RuntimeError as exc:
            self.send_json(409, {"ok": False, "error": str(exc)})
        except (ValueError, TypeError, json.JSONDecodeError, IndexError) as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self.send_json(502, {"ok": False, "error": str(exc)})

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")


if __name__ == "__main__":
    print(f"EnterpriseRAG dashboard listening on http://{HOST}:{PORT}")
    print(f"Parquet: {PARQUET_PATH}")
    print(f"Backend: {XYNE_BACKEND_URL}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
