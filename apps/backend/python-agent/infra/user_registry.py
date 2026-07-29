"""
Workspace user name registry for STT keyword hints.

Fetches all user display names from the backend once and caches them with
a configurable TTL so that every transcription request has an up-to-date
list without hitting the DB on every call.
"""
import asyncio
import time
from typing import List, Optional

import aiohttp
from config.logging import get_logger

logger = get_logger(__name__)

_CACHE_TTL_SECONDS = 3600  # refresh every 1 hour


class UserRegistry:
    """Lazy-loading, TTL-cached workspace user name list."""

    def __init__(self, backend_url: str, api_key: str, ttl: int = _CACHE_TTL_SECONDS) -> None:
        self._backend_url = backend_url.rstrip('/')
        self._api_key = api_key
        self._ttl = ttl
        self._names: List[str] = []
        self._fetched_at: float = 0.0
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_names(self) -> List[str]:
        """Return cached names, refreshing if the TTL has expired."""
        async with self._lock:
            if self._is_stale():
                await self._refresh()
        return list(self._names)

    async def force_refresh(self) -> List[str]:
        """Unconditionally re-fetch from the backend."""
        async with self._lock:
            await self._refresh()
        return list(self._names)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _is_stale(self) -> bool:
        return (time.monotonic() - self._fetched_at) >= self._ttl

    async def _refresh(self) -> None:
        if not self._backend_url or not self._api_key:
            logger.warning('[UserRegistry] backend_url or api_key not configured — skipping user name fetch')
            return

        url = f'{self._backend_url}/api/transcriptionAgent/user-names'
        headers = {'x-api-key': self._api_key}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    if response.status == 200:
                        body = await response.json()
                        names = body.get('names', [])
                        self._names = [n for n in names if isinstance(n, str) and n.strip()]
                        self._fetched_at = time.monotonic()
                        logger.info(f'[UserRegistry] Fetched {len(self._names)} user names from backend')
                    elif response.status == 401:
                        logger.error('[UserRegistry] Auth failed (401) — check TRANSCRIPTION_AGENT_API_KEY')
                    else:
                        text = await response.text()
                        logger.error(f'[UserRegistry] Unexpected status {response.status}: {text[:200]}')
        except asyncio.TimeoutError:
            logger.error('[UserRegistry] Request timed out')
        except aiohttp.ClientError as e:
            logger.error(f'[UserRegistry] HTTP error: {e}')
        except Exception as e:
            logger.error(f'[UserRegistry] Unexpected error: {type(e).__name__}: {e}')


# Module-level singleton — initialised by transcribe_audio_handler on first use
_registry: Optional[UserRegistry] = None


def get_user_registry(backend_url: str, api_key: str) -> UserRegistry:
    """Return (or create) the module-level UserRegistry singleton."""
    global _registry
    if _registry is None:
        _registry = UserRegistry(backend_url, api_key)
        logger.info('[UserRegistry] Registry initialised')
    return _registry
