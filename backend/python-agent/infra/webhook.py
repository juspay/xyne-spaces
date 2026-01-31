"""Webhook notification with retry logic"""
import asyncio
import aiohttp
from config.logging import get_logger

logger = get_logger(__name__)


class WebhookNotifier:
    """Notifies backend when transcript is ready with exponential backoff retry"""

    def __init__(self, backend_url: str, api_key: str, max_retries: int = 5):
        self.backend_url = backend_url
        self.api_key = api_key
        self.max_retries = max_retries

    async def notify_transcript_ready(self, call_id: str) -> bool:
        if not self.backend_url or not self.api_key:
            logger.error("[WEBHOOK] API failed: backend URL or API key not configured")
            return False

        url = f"{self.backend_url}/api/transcriptionAgent/{call_id}/transcript-ready"
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

        for attempt in range(self.max_retries):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        url,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=30),
                    ) as response:
                        if response.status in (200, 204):
                            logger.info(f"[WEBHOOK] API success for call {call_id}")
                            return True
                        if response.status == 401:
                            break
            except (asyncio.TimeoutError, aiohttp.ClientError):
                pass
            except Exception:
                pass

            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 ** attempt)

        logger.error(f"[WEBHOOK] API failed for call {call_id}")
        return False
