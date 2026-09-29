"""
Generic whole-file transcription: local audio file -> text.

This is the input-agnostic core. Adapters (today: transcribe_recording_handler.py,
which downloads a recording URL) are responsible for getting the audio onto local
disk and for deleting it afterwards; everything from there to text lives here: the
Google BatchRecognize call (modules/google_batch_stt.py), a bounded retry, and a
process-wide concurrency cap.

The file is always sent whole — BatchRecognize takes up to 8 hours of audio in one
request, so there is no local decoding or chunking. Concurrency is bounded by a
semaphore (RECORDING_MAX_CONCURRENT_JOBS) so long jobs can't starve the live
LiveKit worker that shares this process.

Errors are raised as TranscriptionError(code, message, permanent) — adapters map
them to whatever transport they speak.
"""

import asyncio
import os
import re
import time
from typing import Optional, Tuple

from google.api_core import exceptions as gexc

from config import Config, get_logger
from modules.google_batch_stt import transcribe_with_google_batch

logger = get_logger(__name__)

PROVIDER = "google"

_MAX_ATTEMPTS = 3
_RETRY_DELAYS_S: Tuple[float, ...] = (2.0, 6.0, 18.0)

_RETRYABLE = (
    gexc.ServiceUnavailable,
    gexc.DeadlineExceeded,
    gexc.ResourceExhausted,
    gexc.TooManyRequests,
    gexc.InternalServerError,
    gexc.Aborted,
    asyncio.TimeoutError,
    TimeoutError,
)

# Created lazily on the first call so it binds to the running event loop.
_semaphore: Optional[asyncio.Semaphore] = None


class TranscriptionError(Exception):
    """Transcription failed. `permanent` = retrying with the same audio won't help."""

    def __init__(self, code: str, message: str, permanent: bool):
        super().__init__(message)
        self.code = code
        self.message = message
        self.permanent = permanent


# --------------------------------------------------------------------------- #
# Retry
# --------------------------------------------------------------------------- #

# Per-file errors reported inside a successful batch operation surface as
# ValueError("Google STT failed (503): ...") — pull the status back out.
_STATUS_IN_MESSAGE = re.compile(r"STT failed \((\d{3})\)")


def _status_from_message(exc: BaseException) -> Optional[int]:
    m = _STATUS_IN_MESSAGE.search(str(exc))
    return int(m.group(1)) if m else None


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, _RETRYABLE):
        return True
    status = _status_from_message(exc)
    if status is not None:
        return status == 429 or status >= 500
    return False


def _is_unsupported_media(exc: BaseException) -> bool:
    """Permanent media problem: Google rejected the audio itself."""
    if isinstance(exc, gexc.InvalidArgument):
        return True
    return _status_from_message(exc) in (400, 415)


async def _transcribe_with_retry(path: str, cfg: Config, language: str, job_id: str) -> Tuple[str, str, str]:
    """BatchRecognize wrapped in a bounded retry. Returns (text, language, model).

    Raises TranscriptionError(unsupported_media, permanent) when Google rejects the
    audio itself; any other error after the retries is TranscriptionError(
    transcription_failed, transient).
    """
    last: Optional[BaseException] = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return await transcribe_with_google_batch(path, cfg, language, job_id)
        except TranscriptionError:
            raise  # already classified by the provider (e.g. batch operation timeout)
        except Exception as e:  # noqa: BLE001 — classified below
            if _is_unsupported_media(e):
                raise TranscriptionError("unsupported_media", f"provider rejected audio: {e}", True) from e
            last = e
            if not _is_retryable(e) or attempt >= _MAX_ATTEMPTS:
                break
            delay = _RETRY_DELAYS_S[min(attempt - 1, len(_RETRY_DELAYS_S) - 1)]
            logger.warning(
                f"[recording_transcriber] Transient provider error | attempt={attempt}/{_MAX_ATTEMPTS}"
                f" | retry_in={delay:.0f}s | {type(e).__name__}: {e}"
            )
            await asyncio.sleep(delay)
    raise TranscriptionError(
        "transcription_failed", f"{type(last).__name__}: {last}", False
    ) from last


# --------------------------------------------------------------------------- #
# Core
# --------------------------------------------------------------------------- #

def _get_semaphore(cfg: Config) -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, int(cfg.recording_max_concurrent_jobs)))
    return _semaphore


async def transcribe_audio_file(
    path: str,
    cfg: Config,
    *,
    language: str = "",
    job_id: str = "",
) -> str:
    """
    Audio in, text out. Transcribe a local audio file and return the transcript as
    plain text ("" if nothing was recognised). What happens to the text (HTTP
    response, upload, ...) is the adapter's business.

    The caller owns `path`; this function never deletes it. Raises TranscriptionError.
    """
    started = time.monotonic()
    tag = f"[recording_transcriber] jobId={job_id or '-'}"
    size = os.path.getsize(path)

    async with _get_semaphore(cfg):
        text, _, model_name = await _transcribe_with_retry(path, cfg, language, job_id)

    text = (text or "").strip()
    logger.info(
        f"{tag} | done | provider={PROVIDER} | model={model_name} | bytes={size}"
        f" | chars={len(text)} | elapsed={time.monotonic() - started:.1f}s"
    )
    return text


__all__ = [
    "PROVIDER",
    "TranscriptionError",
    "transcribe_audio_file",
]
