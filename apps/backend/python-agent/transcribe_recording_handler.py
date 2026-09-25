"""
Route handler for transcribing a call recording by URL.

Registered by health_server.py:
  POST /transcribe-recording -> transcribe_recording

This is the "recording URL" input adapter over the generic core in
modules/recording_transcriber.py: validate the URL (SSRF guard), stream the file
to a temp path, hand it to `transcribe_audio_file`, map errors to JSON, delete
the temp file. Other input modes (raw upload, bucket path) would be sibling
adapters over the same core.

Called synchronously by the Node backend from a Bull job (the caller waits for the timeout duration).

Request body (JSON): {jobId: str, recordingUrl: str, language?: str}

Response codes
--------------
200  {text, provider}
400  {error, code: "bad_request"}           missing/invalid body fields
422  {error, code: "invalid_url"}           non-https / non-public host / pattern mismatch
422  {error, code: "too_large"}             exceeds RECORDING_MAX_BYTES
422  {error, code: "recording_unavailable"} upstream 403/404/410 (or empty body)
422  {error, code: "unsupported_media"}     Google rejected the audio (INVALID_ARGUMENT)
502  {error, code: "download_failed"}       transient download failure (caller retries)
502  {error, code: "transcription_failed"}  provider failure after retries (caller retries)
"""

import asyncio
import ipaddress
import os
import re
import socket
import tempfile
import time
import traceback
from typing import Any, Optional, Set, Tuple
from urllib.parse import urljoin, urlsplit, urlunsplit

import aiohttp
from aiohttp import web

from config import Config, get_logger
from modules.recording_transcriber import (
    PROVIDER,
    TranscriptionError,
    transcribe_audio_file,
)

# Extensions we keep on the downloaded file (they become the scratch object's name and
# content type); anything else is saved as .bin. Google decodes from content either way.
AUDIO_SUFFIXES = frozenset({
    ".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".oga", ".opus",
    ".flac", ".aac", ".webm", ".amr", ".mka", ".wma", ".aiff", ".aif",
})

logger = get_logger(__name__)

_DOWNLOAD_TIMEOUT_S = 600
_DOWNLOAD_CHUNK_BYTES = 64 * 1024
_MAX_REDIRECT_HOPS = 3
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_UNAVAILABLE_STATUSES = {403, 404, 410}


class RecordingError(Exception):
    """Error that maps directly onto an HTTP error response."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def to_response(self) -> web.Response:
        return web.json_response({"error": self.message, "code": self.code}, status=self.status)


# --------------------------------------------------------------------------- #
# URL handling (SSRF guard)
# --------------------------------------------------------------------------- #

def _log_safe_url(url: str) -> str:
    """scheme://host/path only — never the query string (signed URLs carry secrets)."""
    try:
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.hostname or "", parts.path, "", ""))
    except Exception:
        return "<unparseable>"


def _is_public_address(addr: str) -> bool:
    """True only for globally routable unicast addresses."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    # IPv4-mapped IPv6 (::ffff:10.0.0.1) must be judged by the embedded IPv4.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not (
        ip.is_loopback
        or ip.is_private       # RFC1918 / ULA
        or ip.is_link_local    # 169.254/16 incl. cloud metadata endpoints
        or ip.is_unspecified
        or ip.is_multicast
        or ip.is_reserved
    )


def _resolve_addresses(host: str, port: int) -> Set[str]:
    """Blocking DNS lookup — run via asyncio.to_thread."""
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    return {info[4][0] for info in infos if info and info[4]}


async def _validate_recording_url(url: str, cfg: Config) -> None:
    """SSRF guard. Raises RecordingError(422, invalid_url) on any failure."""
    try:
        parts = urlsplit(url)
    except Exception:
        raise RecordingError(422, "invalid_url", "recordingUrl could not be parsed")

    if parts.scheme.lower() != "https":
        raise RecordingError(422, "invalid_url", "recordingUrl must use https")
    host = parts.hostname
    if not host:
        raise RecordingError(422, "invalid_url", "recordingUrl has no host")
    try:
        port = parts.port or 443
    except ValueError:
        raise RecordingError(422, "invalid_url", "recordingUrl has an invalid port")

    pattern = (cfg.recording_url_pattern or "").strip()
    if pattern:
        try:
            matched = re.fullmatch(pattern, url) is not None
        except re.error as e:
            logger.error(f"[transcribe_recording] Invalid RECORDING_URL_PATTERN: {e}")
            matched = False
        if not matched:
            raise RecordingError(422, "invalid_url", "recordingUrl does not match RECORDING_URL_PATTERN")

    # IP literals need no DNS; everything else must resolve, and every address must be public.
    try:
        ipaddress.ip_address(host)
        addresses = {host}
    except ValueError:
        try:
            addresses = await asyncio.to_thread(_resolve_addresses, host, port)
        except (socket.gaierror, OSError) as e:
            raise RecordingError(422, "invalid_url", f"recordingUrl host does not resolve: {e}")

    if not addresses:
        raise RecordingError(422, "invalid_url", "recordingUrl host does not resolve")
    for addr in addresses:
        if not _is_public_address(addr):
            raise RecordingError(422, "invalid_url", "recordingUrl resolves to a non-public address")


def _suffix_from_url(url: str) -> str:
    try:
        ext = os.path.splitext(urlsplit(url).path)[1].lower()
    except Exception:
        return ".bin"
    return ext if ext in AUDIO_SUFFIXES else ".bin"


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #

def _unlink_quiet(path: Optional[str]) -> None:
    if path and os.path.exists(path):
        try:
            os.unlink(path)
        except OSError:
            pass


async def _download_recording(url: str, cfg: Config, job_id: str) -> Tuple[str, int]:
    """
    Stream the recording to a temp file, following redirects manually (each hop
    is re-validated by the SSRF guard). Returns (path, bytes). Raises RecordingError.
    """
    max_bytes = int(cfg.recording_max_bytes)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=_suffix_from_url(url))
    tmp_path = tmp.name
    tmp.close()

    timeout = aiohttp.ClientTimeout(total=_DOWNLOAD_TIMEOUT_S)
    current_url = url
    total = 0
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for hop in range(_MAX_REDIRECT_HOPS + 1):
                async with session.get(current_url, allow_redirects=False) as resp:
                    if resp.status in _REDIRECT_STATUSES:
                        location = resp.headers.get("Location")
                        if not location:
                            raise RecordingError(502, "download_failed", f"redirect ({resp.status}) without Location")
                        if hop >= _MAX_REDIRECT_HOPS:
                            raise RecordingError(502, "download_failed", "too many redirects")
                        next_url = urljoin(current_url, location)
                        await _validate_recording_url(next_url, cfg)
                        logger.info(
                            f"[transcribe_recording] Following redirect | jobId={job_id}"
                            f" | hop={hop + 1} | to={_log_safe_url(next_url)}"
                        )
                        current_url = next_url
                        continue

                    if resp.status in _UNAVAILABLE_STATUSES:
                        raise RecordingError(422, "recording_unavailable", f"recording returned HTTP {resp.status}")
                    if resp.status < 200 or resp.status >= 300:
                        raise RecordingError(502, "download_failed", f"recording returned HTTP {resp.status}")

                    if resp.content_length is not None and resp.content_length > max_bytes:
                        raise RecordingError(
                            422, "too_large",
                            f"recording is {resp.content_length} bytes (max {max_bytes})",
                        )

                    with open(tmp_path, "wb") as out:
                        async for chunk in resp.content.iter_chunked(_DOWNLOAD_CHUNK_BYTES):
                            total += len(chunk)
                            if total > max_bytes:
                                raise RecordingError(422, "too_large", f"recording exceeds {max_bytes} bytes")
                            out.write(chunk)
                    break
            else:  # pragma: no cover — the loop always breaks or raises
                raise RecordingError(502, "download_failed", "too many redirects")
    except RecordingError:
        _unlink_quiet(tmp_path)
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError, OSError) as e:
        _unlink_quiet(tmp_path)
        raise RecordingError(502, "download_failed", f"download failed: {type(e).__name__}: {e}")

    if total == 0:
        _unlink_quiet(tmp_path)
        raise RecordingError(422, "recording_unavailable", "recording is empty")
    return tmp_path, total


# --------------------------------------------------------------------------- #
# Route handler
# --------------------------------------------------------------------------- #

async def transcribe_recording(request: web.Request) -> web.Response:
    """
    POST /transcribe-recording
    JSON body: {jobId: str, recordingUrl: str, language?: str}
    """
    started = time.monotonic()
    try:
        body: Any = await request.json()
    except Exception:
        return web.json_response({"error": "Body must be valid JSON", "code": "bad_request"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "Body must be a JSON object", "code": "bad_request"}, status=400)

    job_id = body.get("jobId")
    recording_url = body.get("recordingUrl")
    language = body.get("language") or ""
    if not isinstance(job_id, str) or not job_id.strip():
        return web.json_response({"error": "jobId is required", "code": "bad_request"}, status=400)
    if not isinstance(recording_url, str) or not recording_url.strip():
        return web.json_response({"error": "recordingUrl is required", "code": "bad_request"}, status=400)
    if not isinstance(language, str):
        return web.json_response({"error": "language must be a string", "code": "bad_request"}, status=400)
    job_id = job_id.strip()
    recording_url = recording_url.strip()
    language = language.strip()

    cfg = Config.load()
    provider = PROVIDER
    logger.info(
        f"[transcribe_recording] Job start | jobId={job_id} | provider={provider}"
        f" | url={_log_safe_url(recording_url)} | language={language or '(default)'}"
    )

    downloaded_path: Optional[str] = None
    total_bytes = 0
    try:
        await _validate_recording_url(recording_url, cfg)
        downloaded_path, total_bytes = await _download_recording(recording_url, cfg, job_id)
        logger.info(
            f"[transcribe_recording] Downloaded | jobId={job_id}"
            f" | bytes={total_bytes} | elapsed={time.monotonic() - started:.1f}s"
        )

        text = await transcribe_audio_file(downloaded_path, cfg, language=language, job_id=job_id)
        return web.json_response({"text": text, "provider": provider})

    except RecordingError as e:
        logger.warning(
            f"[transcribe_recording] Job failed | jobId={job_id} | code={e.code} | status={e.status}"
            f" | bytes={total_bytes} | elapsed={time.monotonic() - started:.1f}s | {e.message}"
        )
        return e.to_response()
    except TranscriptionError as e:
        status = 422 if e.permanent else 502
        logger.warning(
            f"[transcribe_recording] Job failed | jobId={job_id} | code={e.code} | status={status}"
            f" | bytes={total_bytes} | elapsed={time.monotonic() - started:.1f}s | {e.message}"
        )
        return web.json_response({"error": e.message, "code": e.code}, status=status)
    except Exception as e:
        logger.error(
            f"[transcribe_recording] Job failed | jobId={job_id} | code=transcription_failed"
            f" | bytes={total_bytes} | elapsed={time.monotonic() - started:.1f}s"
            f" | {type(e).__name__}: {e}\n{traceback.format_exc()}"
        )
        return web.json_response(
            {"error": f"{type(e).__name__}: {e}", "code": "transcription_failed"}, status=502
        )
    finally:
        _unlink_quiet(downloaded_path)


__all__ = ["transcribe_recording", "RecordingError"]
