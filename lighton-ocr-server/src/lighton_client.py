"""Async OpenAI-compatible client for external LightOn OCR serving."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx
from typing_extensions import Self

from image_utils import encode_image_jpeg_data_url

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import Callable

    from PIL import Image

_MAX_REPEATED_LINES = 2
_MAX_REPEATED_TOKENS = 3
_TOKEN_RE = re.compile(r"\S+")


@dataclass(frozen=True)
class LightOnClientConfig:
    endpoint_url: str
    model: str
    token: str
    timeout_seconds: float
    max_output_tokens: int
    temperature: float
    concurrency: int
    retries: int
    ssl_verify: bool
    image_max_dim: int
    jpeg_quality: int


class LightOnClient:
    def __init__(
        self,
        config: LightOnClientConfig,
        *,
        concurrency_provider: Callable[[], int] | None = None,
    ) -> None:
        if not config.endpoint_url:
            raise ValueError("LIGHTON_URL is required")
        self.config = config
        self._concurrency_provider = concurrency_provider or (lambda: config.concurrency)
        max_expected_concurrency = max(config.concurrency, self._current_concurrency(), 256)
        limits = httpx.Limits(
            max_connections=max(max_expected_concurrency * 2, 4),
            max_keepalive_connections=max(max_expected_concurrency, 2),
        )
        self._client = httpx.AsyncClient(
            timeout=config.timeout_seconds,
            limits=limits,
            verify=config.ssl_verify,
        )
        self._gate = _DynamicConcurrencyGate(self._current_concurrency)

    async def close(self) -> None:
        await self._client.aclose()

    async def ocr_image(self, img: Image.Image, prompt: str) -> str:
        payload = self._payload(img, prompt)
        headers = {"Content-Type": "application/json"}
        if self.config.token:
            headers["Authorization"] = f"Bearer {self.config.token}"

        last_exc: Exception | None = None
        call_start = time.time()
        for attempt in range(self.config.retries + 1):
            try:
                logger.info(
                    "[lighton_client] ocr_request attempt=%d/%d endpoint=%s",
                    attempt + 1, self.config.retries + 1, self.config.endpoint_url,
                )
                async with self._gate:
                    response = await self._client.post(
                        self.config.endpoint_url,
                        json=payload,
                        headers=headers,
                    )
                response.raise_for_status()
                content = _clean_response(_extract_content(response.json()), prompt)
                logger.info(
                    "[lighton_client] ocr_success attempt=%d elapsed=%.2fs response_len=%d",
                    attempt + 1, time.time() - call_start, len(content),
                )
                return content
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "[lighton_client] ocr_error attempt=%d/%d elapsed=%.2fs error=%s",
                    attempt + 1, self.config.retries + 1, time.time() - call_start, exc,
                )
                if attempt >= self.config.retries:
                    break
                await asyncio.sleep(min(2.0, 0.25 * (2**attempt)))
        logger.error(
            "[lighton_client] ocr_failed all %d attempts elapsed=%.2fs last_error=%s",
            self.config.retries + 1, time.time() - call_start, last_exc,
        )
        if last_exc is None:
            raise RuntimeError("LightOn OCR request failed without an exception")
        raise last_exc

    def _current_concurrency(self) -> int:
        try:
            return max(1, int(self._concurrency_provider()))
        except Exception:
            return max(1, self.config.concurrency)

    def _payload(self, img: Image.Image, prompt: str) -> dict[str, Any]:
        return {
            "model": self.config.model,
            "max_tokens": self.config.max_output_tokens,
            "temperature": self.config.temperature,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": encode_image_jpeg_data_url(
                                    img,
                                    max_dim=self.config.image_max_dim,
                                    quality=self.config.jpeg_quality,
                                )
                            },
                        },
                    ],
                }
            ],
        }


def _extract_content(payload: dict[str, Any]) -> Any:
    try:
        return payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return ""


def _clean_response(content: Any, prompt: str = "") -> str:
    text = str(content or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[-1].strip().startswith("```"):
            text = "\n".join(lines[1:-1]).strip()
        else:
            text = "\n".join(lines[1:]).strip()
    if prompt and text.startswith(prompt.strip()):
        text = text[len(prompt.strip()) :].lstrip()
    return _truncate_repetition(text)


def _truncate_repetition(text: str) -> str:
    text = re.sub(r"(.)\1{5,}", lambda match: match.group(1) * 3, text)
    text = _dedupe_repeated_tokens(text)
    text = re.sub(r"(.{2,200}?)\1{3,}", r"\1", text, flags=re.DOTALL)
    return _dedupe_repeated_blocks(text).strip()


def _dedupe_repeated_tokens(text: str) -> str:
    previous = ""
    repeat_count = 0
    pieces: list[str] = []
    cursor = 0

    for match in _TOKEN_RE.finditer(text):
        token = match.group(0)
        normalized = token.strip(".,;:!?()[]{}\"'`").lower()
        if normalized and normalized == previous:
            repeat_count += 1
        else:
            previous = normalized
            repeat_count = 1

        if repeat_count <= _MAX_REPEATED_TOKENS:
            pieces.append(text[cursor : match.end()])
        cursor = match.end()

    pieces.append(text[cursor:])
    return "".join(pieces)


def _dedupe_repeated_blocks(text: str) -> str:
    blocks = [block.strip() for block in re.split(r"\n{2,}", text) if block.strip()]
    if not blocks:
        return text

    deduped: list[str] = []
    previous = ""
    repeat_count = 0
    for block in blocks:
        normalized = _normalize_for_repeat_check(block)
        if normalized and normalized == previous:
            repeat_count += 1
            if repeat_count > 1:
                continue
        else:
            repeat_count = 1
            previous = normalized
        deduped.append(block)

    lines = "\n\n".join(deduped).splitlines()
    deduped_lines: list[str] = []
    previous_line = ""
    line_repeat_count = 0
    for line in lines:
        normalized = _normalize_for_repeat_check(line)
        if normalized and normalized == previous_line:
            line_repeat_count += 1
            if line_repeat_count > _MAX_REPEATED_LINES:
                continue
        else:
            line_repeat_count = 1
            previous_line = normalized
        deduped_lines.append(line.rstrip())
    return "\n".join(deduped_lines)


def _normalize_for_repeat_check(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


class _DynamicConcurrencyGate:
    def __init__(self, concurrency_provider: Callable[[], int]) -> None:
        self._concurrency_provider = concurrency_provider
        self._condition = asyncio.Condition()
        self._active = 0

    async def __aenter__(self) -> Self:
        async with self._condition:
            while True:
                limit = max(1, int(self._concurrency_provider()))
                if self._active < limit:
                    self._active += 1
                    return self
                try:
                    await asyncio.wait_for(self._condition.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        async with self._condition:
            self._active = max(0, self._active - 1)
            self._condition.notify_all()
