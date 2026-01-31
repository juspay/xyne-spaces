"""
Cleanup manager - handles graceful shutdown when all participants leave
"""
import asyncio
import logging
from typing import Dict, Optional

from livekit import rtc
from transcription import TranscriptionStorage
from infra import WebhookNotifier
from history import ConversationStore

logger = logging.getLogger(__name__)


class CleanupManager:
    """
    Manages graceful cleanup when all participants leave the room.
    """

    def __init__(
        self,
        call_id: str,
        stt_tasks: Dict[str, asyncio.Task],
        storage: TranscriptionStorage,
        webhook: WebhookNotifier,
        room: rtc.Room,
        conversation_store: Optional[ConversationStore] = None,
    ):
        self.call_id = call_id
        self.stt_tasks = stt_tasks
        self.storage = storage
        self.webhook = webhook
        self.room = room
        self.conversation_store = conversation_store

    async def run(self):
        """Execute full cleanup sequence with hard deadline"""
        logger.info("Cleanup started")

        try:
            await asyncio.wait_for(self._run_cleanup_steps(), timeout=30.0)
            logger.info("Cleanup completed successfully")
        except asyncio.TimeoutError:
            logger.error("Cleanup timed out after 30s, forcing disconnect")
            await self._force_disconnect()

    async def _run_cleanup_steps(self):
        # 1. Upload transcript to GCS (what we have so far)
        await self._flush_storage()
        
        # 2. Send transcript to BE using S2S api
        await self._notify_backend()
        
        # 3. If any pending STT are left, wait for completion and update transcript
        await self._drain_and_update_stt()
        
        # 4. Delete REDIS entry
        await self._cleanup_state()
        
        # 5. Close LiveKit room
        await self._disconnect()

    async def _drain_and_update_stt(self):
        """Wait for pending STT tasks and upload any remaining transcripts."""
        if not self.stt_tasks:
            return
            
        # Grace period for in-flight STT
        await asyncio.sleep(3)

        # Wait for pending tasks to complete (don't cancel immediately)
        pending_tasks = [t for t in self.stt_tasks.values() if not t.done()]
        if pending_tasks:
            logger.info(f"Waiting for {len(pending_tasks)} pending STT tasks")
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending_tasks, return_exceptions=True),
                    timeout=10.0,
                )
            except asyncio.TimeoutError:
                logger.warning("STT tasks timed out, cancelling remaining")
                for task in pending_tasks:
                    if not task.done():
                        task.cancel()
        
        # Flush any remaining transcripts from pending STT
        try:
            await self.storage.flush()
            logger.info("Flushed remaining transcripts after STT drain")
        except Exception:
            logger.error("Failed to flush remaining transcripts", exc_info=True)
        
        # Notify backend again if we had pending STT (transcript updated)
        if pending_tasks:
            try:
                await self.webhook.notify_transcript_ready(self.call_id)
                logger.info("Notified backend of updated transcript")
            except Exception:
                logger.error("Failed to notify backend of transcript update", exc_info=True)

    async def _flush_storage(self):
        try:
            await self.storage.flush()
        except Exception:
            logger.error("Failed to flush transcription storage", exc_info=True)

    async def _notify_backend(self):
        try:
            await self.webhook.notify_transcript_ready(self.call_id)
        except Exception:
            logger.error("Failed to notify backend via webhook", exc_info=True)

    async def _cleanup_state(self):
        if not self.conversation_store:
            return

        try:
            await self.conversation_store.delete()
            await self.conversation_store.redis_client.aclose()
        except Exception:
            logger.error("Failed to clean up conversation store", exc_info=True)

    async def _disconnect(self):
        try:
            await self.room.disconnect()
        except Exception:
            logger.error("Failed to disconnect from room", exc_info=True)

    async def _force_disconnect(self):
        try:
            await asyncio.wait_for(self.room.disconnect(), timeout=2.0)
        except Exception:
            logger.error("Force disconnect failed", exc_info=True)
