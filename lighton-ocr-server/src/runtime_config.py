"""Redis-polled runtime config for OCR admission and LightOn concurrency."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
from dataclasses import dataclass
from typing import Any

from config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuntimeConfig:
    submit_permits: int
    wrapper_lighton_concurrency: int
    wrapper_async_max_inflight: int
    version: str | None = None
    updated_at: str | None = None
    source: str = "defaults"


def _default_submit_permits() -> int:
    if settings.async_global_max_inflight > 0:
        return settings.async_global_max_inflight
    return max(1, settings.async_max_inflight)


DEFAULT_RUNTIME_CONFIG = RuntimeConfig(
    submit_permits=_default_submit_permits(),
    wrapper_lighton_concurrency=max(1, settings.lighton_concurrency),
    wrapper_async_max_inflight=max(1, settings.async_max_inflight),
)


@dataclass
class _RuntimeConfigState:
    current: RuntimeConfig = DEFAULT_RUNTIME_CONFIG
    poll_task: asyncio.Task[None] | None = None
    redis_client: Any | None = None


_state = _RuntimeConfigState()
_refresh_lock = asyncio.Lock()


def _parse_positive_int(raw: str | None, fallback: int) -> int:
    try:
        parsed = int((raw or "").strip())
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def get_runtime_config() -> RuntimeConfig:
    return _state.current


def current_submit_permits() -> int:
    return get_runtime_config().submit_permits


def current_wrapper_lighton_concurrency() -> int:
    return get_runtime_config().wrapper_lighton_concurrency


def current_wrapper_async_max_inflight() -> int:
    return get_runtime_config().wrapper_async_max_inflight


async def refresh_runtime_config() -> RuntimeConfig:
    async with _refresh_lock:
        try:
            redis = await _get_redis_client()
            payload = await _maybe_await(redis.hgetall(settings.runtime_config_key))
            if payload:
                next_runtime_config = RuntimeConfig(
                    submit_permits=_parse_positive_int(
                        payload.get("submit_permits"),
                        DEFAULT_RUNTIME_CONFIG.submit_permits,
                    ),
                    wrapper_lighton_concurrency=_parse_positive_int(
                        payload.get("wrapper_lighton_concurrency"),
                        DEFAULT_RUNTIME_CONFIG.wrapper_lighton_concurrency,
                    ),
                    wrapper_async_max_inflight=_parse_positive_int(
                        payload.get("wrapper_async_max_inflight"),
                        DEFAULT_RUNTIME_CONFIG.wrapper_async_max_inflight,
                    ),
                    version=(payload.get("version") or "").strip() or None,
                    updated_at=(payload.get("updated_at") or "").strip() or None,
                    source="redis",
                )
            else:
                next_runtime_config = DEFAULT_RUNTIME_CONFIG

            if next_runtime_config != _state.current:
                logger.info(
                    "Updated OCR runtime config from Redis",
                    extra={
                        "redis_key": settings.runtime_config_key,
                        "previous": _state.current,
                        "next": next_runtime_config,
                    },
                )

            _state.current = next_runtime_config
        except Exception as exc:
            logger.warning(
                "Failed to refresh OCR runtime config from Redis; keeping previous values"
                " | redis_url=%s key=%s error=%s",
                settings.redis_url,
                settings.runtime_config_key,
                exc,
            )

        return _state.current


async def start_runtime_config_poller() -> None:
    if _state.poll_task is not None and not _state.poll_task.done():
        return

    await refresh_runtime_config()

    async def _poll_loop() -> None:
        while True:
            await asyncio.sleep(settings.runtime_config_poll_seconds)
            await refresh_runtime_config()

    _state.poll_task = asyncio.create_task(_poll_loop(), name="ocr-runtime-config-poller")


async def stop_runtime_config_poller() -> None:
    task = _state.poll_task
    _state.poll_task = None
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    if _state.redis_client is not None:
        with contextlib.suppress(Exception):
            await _maybe_await(_state.redis_client.aclose())
        _state.redis_client = None


async def _get_redis_client() -> Any:
    if _state.redis_client is None:
        from redis.asyncio import Redis

        _state.redis_client = Redis.from_url(settings.redis_url, **settings.redis_client_kwargs)

    return _state.redis_client


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value
