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
            logger.error("[WEBHOOK] API failed: backend URL or API key not configured")
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
                            logger.info(f"[WEBHOOK] API success for call {call_id}, has_transcript={has_transcript}")
                            return True
                        if response.status == 401:
                            break
            except (asyncio.TimeoutError, aiohttp.ClientError):
                pass
            except Exception:
                pass

            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 ** attempt)

        logger.error(f"[WEBHOOK] API failed for call {call_id}, has_transcript={has_transcript}")
        return False

    async def fetch_voiceprints(self) -> List[dict]:
        """
        Fetch all enrolled voice signatures from the backend at runtime.

        Called once when the agent joins a room so the 64 KB LiveKit metadata
        limit is never a concern, and the list always reflects the latest enrollments.
        Returns a list of {userId, name, embeddingB64} dicts, or [] on failure.
        """
        if not self.backend_url or not self.api_key:
            logger.error("[VOICEPRINTS] backend URL or API key not configured")
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
                        logger.info(f"[VOICEPRINTS] Fetched {len(voiceprints)} voiceprints from backend")
                        return voiceprints
                    else:
                        logger.error(f"[VOICEPRINTS] Unexpected status {response.status} fetching voiceprints")
                        return []
        except Exception as e:
            logger.error(f"[VOICEPRINTS] Exception fetching voiceprints: {e}")
            return []
