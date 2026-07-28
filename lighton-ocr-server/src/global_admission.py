"""Redis-backed fleet-wide admission control for async OCR jobs."""

from __future__ import annotations

import inspect
import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from config import settings

if TYPE_CHECKING:
    from collections.abc import Callable

ACQUIRE_SCRIPT = """
local active_key = KEYS[1]
local meta_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local expires_at_ms = tonumber(ARGV[3])
local lease_ttl_ms = tonumber(ARGV[4])
local job_id = ARGV[5]

redis.call("ZREMRANGEBYSCORE", active_key, "-inf", now_ms)

if redis.call("ZSCORE", active_key, job_id) then
  return {2, redis.call("ZCARD", active_key)}
end

local active = redis.call("ZCARD", active_key)
if active >= capacity then
  return {0, active}
end

redis.call("ZADD", active_key, expires_at_ms, job_id)
redis.call(
  "HSET",
  meta_key,
  "job_id", job_id,
  "file_id", ARGV[6],
  "doc_id", ARGV[7],
  "vespa_doc_id", ARGV[8],
  "instance_id", ARGV[9],
  "acquired_at", ARGV[10],
  "expires_at_ms", ARGV[3]
)
redis.call("PEXPIRE", meta_key, lease_ttl_ms)
return {1, active + 1}
"""

RELEASE_SCRIPT = """
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2])
return removed
"""

ADMISSION_ACCEPTED = 1
ADMISSION_DUPLICATE = 2


@dataclass(frozen=True)
class AdmissionResult:
    accepted: bool
    duplicate: bool = False
    active_count: int = 0
    retry_after_seconds: int = settings.async_retry_after_seconds


class RedisGlobalAdmission:
    def __init__(
        self,
        *,
        redis_url: str = settings.redis_url,
        active_key: str = settings.async_global_admission_key,
        capacity: int = settings.async_global_max_inflight,
        lease_ttl_seconds: int = settings.async_global_admission_lease_ttl_seconds,
        retry_after_seconds: int = settings.async_retry_after_seconds,
        instance_id: str | None = None,
        capacity_provider: Callable[[], int] | None = None,
        client: Any | None = None,
    ) -> None:
        if capacity == -1:
            raise ValueError(
                "capacity=-1 disables global admission; do not construct RedisGlobalAdmission"
            )
        self.redis_url = redis_url
        self.active_key = active_key
        self.capacity = max(1, capacity)
        self.lease_ttl_ms = max(1, lease_ttl_seconds) * 1000
        self.retry_after_seconds = retry_after_seconds
        self.instance_id = instance_id or os.getenv("HOSTNAME") or "unknown"
        self.capacity_provider = capacity_provider
        self._client = client

    async def acquire(
        self,
        *,
        job_id: str,
        file_id: str,
        doc_id: str,
        vespa_doc_id: str | None,
    ) -> AdmissionResult:
        now_ms = int(time.time() * 1000)
        capacity = self._current_capacity()
        result = await _maybe_await(
            self._redis.eval(
                ACQUIRE_SCRIPT,
                2,
                self.active_key,
                self._meta_key(job_id),
                now_ms,
                capacity,
                now_ms + self.lease_ttl_ms,
                self.lease_ttl_ms,
                job_id,
                file_id,
                doc_id,
                vespa_doc_id or "",
                self.instance_id,
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000)),
            )
        )
        code = int(result[0])
        active_count = int(result[1]) if len(result) > 1 else 0
        if code == ADMISSION_ACCEPTED:
            return AdmissionResult(accepted=True, active_count=active_count)
        if code == ADMISSION_DUPLICATE:
            return AdmissionResult(accepted=True, duplicate=True, active_count=active_count)
        return AdmissionResult(
            accepted=False,
            active_count=active_count,
            retry_after_seconds=self.retry_after_seconds,
        )

    async def release(self, job_id: str) -> None:
        await _maybe_await(
            self._redis.eval(
                RELEASE_SCRIPT,
                2,
                self.active_key,
                self._meta_key(job_id),
                job_id,
            )
        )

    def _meta_key(self, job_id: str) -> str:
        return f"{self.active_key}:meta:{job_id}"

    def _current_capacity(self) -> int:
        if self.capacity_provider is None:
            return self.capacity
        try:
            return max(1, int(self.capacity_provider()))
        except Exception:
            return self.capacity

    @property
    def _redis(self) -> Any:
        if self._client is None:
            try:
                from redis.asyncio import Redis
            except ImportError as exc:
                raise RuntimeError("redis package is not installed; install redis>=5.0.0") from exc
            self._client = Redis.from_url(self.redis_url, **settings.redis_client_kwargs)
        return self._client


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value
