"""
Abstract storage provider interface for transcript storage.
Supports both GCS and S3 backends.
"""
import abc
import io
from typing import Dict, Optional


class BlobWriter(abc.ABC):
    """Abstract writer for streaming writes to cloud storage."""

    @abc.abstractmethod
    def write(self, data: str) -> None:
        ...

    @abc.abstractmethod
    def flush(self) -> None:
        ...

    @abc.abstractmethod
    def close(self) -> None:
        ...


class StorageBucket(abc.ABC):
    """Abstract cloud storage bucket interface."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        ...

    @abc.abstractmethod
    def blob_exists(self, filename: str) -> bool:
        ...

    @abc.abstractmethod
    def download_as_bytes(self, filename: str) -> bytes:
        ...

    @abc.abstractmethod
    def upload_from_string(self, filename: str, content: str, content_type: str) -> None:
        ...

    @abc.abstractmethod
    def upload_bytes(
        self, filename: str, content: bytes, content_type: str, metadata: Optional[Dict[str, str]] = None
    ) -> None:
        """Upload binary content in one request (replaces any existing object), with optional custom metadata."""
        ...

    @abc.abstractmethod
    def open_writer(self, filename: str, content_type: str) -> BlobWriter:
        """Open a streaming writer for the given file."""
        ...
