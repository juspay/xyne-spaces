"""Environment-driven configuration for the LightOn OCR service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except Exception:
        return
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    load_dotenv()


_load_dotenv()


def _env(name: str, default: str = "", aliases: Iterable[str] = ()) -> str:
    for key in (name, *aliases):
        value = os.getenv(key)
        if value is not None:
            return value.strip()
    return default


def _int_env(name: str, default: int, aliases: Iterable[str] = ()) -> int:
    raw = _env(name, str(default), aliases)
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float, aliases: Iterable[str] = ()) -> float:
    raw = _env(name, str(default), aliases)
    try:
        return float(raw)
    except ValueError:
        return default


def _bool_env(name: str, default: bool, aliases: Iterable[str] = ()) -> bool:
    raw = _env(name, "", aliases)
    if not raw:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _redis_url() -> str:
    explicit = _env("REDIS_URL")
    if explicit:
        return explicit
    host = _env("REDIS_HOST", "redis")
    port = _env("REDIS_PORT", "6379")
    password = _env("REDIS_PASSWORD")
    tls = _bool_env("REDIS_TLS", False)
    scheme = "rediss" if tls else "redis"
    auth = f":{password}@" if password else ""
    return f"{scheme}://{auth}{host}:{port}/0"


_REDIS_TLS: bool = _bool_env("REDIS_TLS", False) or _env("REDIS_URL", "").startswith("rediss://")


@dataclass(frozen=True)
class Settings:
    # LightOn / OpenAI-compatible VLM endpoint.
    lighton_url: str = _env("LIGHTON_URL", aliases=("VLM_URL",))
    lighton_model: str = _env(
        "LIGHTON_MODEL",
        "lightonai/LightOnOCR-2-1B-bbox",
        aliases=("VLM_MODEL",),
    )
    lighton_access_token: str = _env(
        "LIGHTON_ACCESS_TOKEN",
        aliases=("VLM_ACCESS_TOKEN",),
    )
    lighton_timeout_seconds: float = _float_env(
        "LIGHTON_TIMEOUT_SECONDS",
        60.0,
        aliases=("VLM_TIMEOUT",),
    )
    lighton_concurrency: int = max(
        1,
        _int_env("LIGHTON_CONCURRENCY", 8, aliases=("VLM_CONCURRENCY",)),
    )
    lighton_max_output_tokens: int = max(
        1,
        _int_env("LIGHTON_MAX_OUTPUT_TOKENS", 8192, aliases=("VLM_MAX_TOKENS",)),
    )
    lighton_temperature: float = _float_env(
        "LIGHTON_TEMPERATURE",
        0.0,
        aliases=("VLM_TEMPERATURE",),
    )
    lighton_retries: int = max(0, _int_env("LIGHTON_RETRIES", 2))
    lighton_ssl_verify: bool = _bool_env(
        "LIGHTON_SSL_VERIFY",
        True,
        aliases=("VLM_SSL_VERIFY",),
    )
    lighton_prompt: str = _env(
        "LIGHTON_PROMPT",
        "Convert this document image to clean markdown.",
        aliases=("IMAGE_VLM_PROMPT",),
    )
    lighton_crop_prompt: str = _env(
        "LIGHTON_CROP_PROMPT",
        "Read all text in this image.",
    )

    # Rendering and image encoding.
    render_max_dim: int = max(256, _int_env("OCR_RENDER_MAX_DIM", 1540))
    pdf_render_dpi: int = max(72, _int_env("OCR_PDF_RENDER_DPI", 200))
    image_max_dim: int = max(
        256,
        _int_env("LIGHTON_IMAGE_MAX_DIM", 1540, aliases=("VLM_IMAGE_MAX_DIM",)),
    )
    jpeg_quality: int = min(95, max(50, _int_env("OCR_JPEG_QUALITY", 90)))
    max_pages: int = _int_env("OCR_MAX_PAGES", -1)
    upload_chunk_size: int = max(65536, _int_env("OCR_UPLOAD_CHUNK_SIZE", 1024 * 1024))
    office_convert_timeout_seconds: float = _float_env("OCR_OFFICE_CONVERT_TIMEOUT_SECONDS", 120.0)
    text_page_width: int = max(512, _int_env("OCR_TEXT_PAGE_WIDTH", 1240))
    text_page_height: int = max(512, _int_env("OCR_TEXT_PAGE_HEIGHT", 1754))
    text_font_size: int = max(8, _int_env("OCR_TEXT_FONT_SIZE", 28))
    text_margin: int = max(16, _int_env("OCR_TEXT_MARGIN", 72))

    # LightOn bbox crop processing.
    min_crop_width: int = max(1, _int_env("LIGHTON_MIN_CROP_WIDTH", 32))
    min_crop_height: int = max(1, _int_env("LIGHTON_MIN_CROP_HEIGHT", 32))
    min_crop_area: int = max(1, _int_env("LIGHTON_MIN_CROP_AREA", 2048))
    crop_padding_pixels: int = max(0, _int_env("LIGHTON_CROP_PADDING_PIXELS", 5))
    max_image_regions_per_page: int = _int_env("LIGHTON_MAX_IMAGE_REGIONS_PER_PAGE", 256)
    max_crops_per_page: int = _int_env("LIGHTON_MAX_CROPS_PER_PAGE", 32)

    # Chunking. Keep output schema strict: text, headings, page_numbers, bbox.
    tokenizer_path: str = _env(
        "E5_TOKENIZER_PATH",
        "/app/e5-tokenizer",
        aliases=("CHUNKER_TOKENIZER_PATH",),
    )
    max_tokens: int = max(
        1,
        _int_env("MAX_TOKENS", 460, aliases=("MAX_CHUNK_TOKENS",)),
    )
    chunk_overlap_tokens: int = max(0, _int_env("CHUNK_OVERLAP_TOKENS", 12))
    image_chunk_max_tokens: int = max(1, _int_env("IMAGE_CHUNK_MAX_TOKENS", max_tokens))

    # Redis result publication and fleet admission.
    redis_url: str = _redis_url()
    results_stream: str = _env(
        "OCR_RESULTS_STREAM",
        "docling:results",
        aliases=("DOCLING_RESULTS_STREAM",),
    )
    result_key_prefix: str = _env(
        "OCR_RESULT_KEY_PREFIX",
        "docling:result",
        aliases=("DOCLING_RESULT_KEY_PREFIX",),
    )
    result_ttl_seconds: int = max(
        1,
        _int_env("OCR_RESULT_TTL_SECONDS", 604800, aliases=("DOCLING_RESULT_TTL_SECONDS",)),
    )
    async_job_ttl_seconds: int = max(
        1,
        _int_env("OCR_ASYNC_JOB_TTL_SECONDS", 86400, aliases=("DOCLING_ASYNC_JOB_TTL_SECONDS",)),
    )
    async_max_inflight: int = max(
        1,
        _int_env("OCR_ASYNC_MAX_INFLIGHT", 1, aliases=("DOCLING_ASYNC_MAX_INFLIGHT",)),
    )
    async_global_max_inflight: int = _int_env(
        "OCR_ASYNC_GLOBAL_MAX_INFLIGHT",
        -1,
        aliases=("DOCLING_ASYNC_GLOBAL_MAX_INFLIGHT",),
    )
    async_global_admission_key: str = _env(
        "OCR_ASYNC_GLOBAL_ADMISSION_KEY",
        "docling:async:global:active",
        aliases=("DOCLING_ASYNC_GLOBAL_ADMISSION_KEY",),
    )
    async_global_admission_lease_ttl_seconds: int = max(
        60,
        _int_env(
            "OCR_ASYNC_GLOBAL_ADMISSION_LEASE_TTL_SECONDS",
            async_job_ttl_seconds,
            aliases=("DOCLING_ASYNC_GLOBAL_ADMISSION_LEASE_TTL_SECONDS",),
        ),
    )
    async_retry_after_seconds: int = max(
        1,
        _int_env(
            "OCR_ASYNC_RETRY_AFTER_SECONDS", 180, aliases=("DOCLING_ASYNC_RETRY_AFTER_SECONDS",)
        ),
    )
    status_ttl_seconds: int = max(1, _int_env("STATUS_TTL_SECONDS", 600))
    runtime_config_key: str = _env("OCR_RUNTIME_CONFIG_KEY", "docling:runtime-config")
    runtime_config_poll_seconds: int = max(5, _int_env("OCR_RUNTIME_CONFIG_POLL_SECONDS", 300))

    @property
    def has_lighton_endpoint(self) -> bool:
        return bool(self.lighton_url)

    @property
    def global_admission_enabled(self) -> bool:
        return self.async_global_max_inflight != -1

    @property
    def redis_client_kwargs(self) -> dict:
        kwargs: dict = {"decode_responses": True}
        if _REDIS_TLS:
            kwargs["ssl_cert_reqs"] = "none"
        return kwargs


settings = Settings()
