"""Webhook notification with retry logic"""
import asyncio
from typing import List
import aiohttp
from config.logging import get_logger

logger = get_logger(__name__)


class WebhookNotifier:
    """Notifies backend when transcript is ready with exponential backoff retry"""

    def __init__(self, backend_url: str, api_key: str, max_retries: int = 5):
        self.backend_url = backend_url
        self.api_key = api_key
        self.max_retries = max_retries

    async def notify_transcript_ready(self, call_id: str, has_transcript: bool = True) -> bool:
        if not self.backend_url or not self.api_key:
            logger.error("webhook_misconfigured", extra={"reason": "backend_url_or_api_key_not_configured"})
            return False

        url = f"{self.backend_url}/api/transcriptionAgent/{call_id}/transcript-ready"
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {"hasTranscript": has_transcript}

        for attempt in range(self.max_retries):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        url,
                        headers=headers,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=30),
                    ) as response:
                        if response.status in (200, 204):
                            logger.info("webhook_api_success", extra={"has_transcript": has_transcript})
                            return True
                        if response.status == 401:
                            # Auth failure — no point retrying; log and break immediately.
                            logger.error(
                                "webhook_retry_auth_failed",
                                extra={"attempt": attempt + 1, "status": 401, "action": "abort_retries"},
                            )
                            break
                        # Non-success, non-auth status — log the attempt so transient backend
                        # errors (502, 503, 429) are visible rather than silently swallowed.
                        logger.warning(
                            "webhook_retry_attempt_failed",
                            extra={"attempt": attempt + 1, "max_retries": self.max_retries, "status": response.status},
                        )
            except asyncio.TimeoutError as e:
                # Timeout on this attempt — log so slow-backend patterns are visible.
                logger.warning(
                    "webhook_retry_attempt_timeout",
                    extra={"attempt": attempt + 1, "max_retries": self.max_retries, "error": str(e)},
                )
            except aiohttp.ClientError as e:
                # Network-level error (DNS, connection refused, etc.)
                logger.warning(
                    "webhook_retry_attempt_client_error",
                    extra={"attempt": attempt + 1, "max_retries": self.max_retries, "error": str(e)},
                )
            except Exception as e:
                # Unexpected error — log so we know it wasn't just a timeout or HTTP error.
                logger.warning(
                    "webhook_retry_attempt_unexpected_error",
                    extra={"attempt": attempt + 1, "max_retries": self.max_retries, "error": str(e)},
                )

            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 ** attempt)

        logger.error("webhook_api_failed", extra={"has_transcript": has_transcript})
        return False

    async def fetch_voiceprints(self) -> List[dict]:
        """
        Fetch all enrolled voice signatures from the backend at runtime.

        Called once when the agent joins a room so the 64 KB LiveKit metadata
        limit is never a concern, and the list always reflects the latest enrollments.
        Returns a list of {userId, name, embeddingB64} dicts, or [] on failure.
        """
        if not self.backend_url or not self.api_key:
            logger.error("voiceprints_misconfigured", extra={"reason": "backend_url_or_api_key_not_configured"})
            return []

        url = f"{self.backend_url}/api/transcriptionAgent/voiceprints"
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        voiceprints = data.get("voiceprints", [])
                        logger.info("voiceprints_fetched", extra={"count": len(voiceprints)})
                        return voiceprints
                    else:
                        logger.error("voiceprints_fetch_failed", extra={"status": response.status})
                        return []
        except Exception as e:
            logger.error("voiceprints_fetch_exception", extra={"error": str(e)})
            return []
