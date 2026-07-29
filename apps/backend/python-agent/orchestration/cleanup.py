"""
Cleanup manager - handles graceful shutdown when all participants leave
"""
import asyncio
import logging
from typing import Dict, List, Optional

from livekit import rtc
from transcription import TranscriptionStorage
from infra import WebhookNotifier
from history import ConversationStore
from config import get_logger

logger = get_logger(__name__)


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
        additional_storages: Optional[List[TranscriptionStorage]] = None,
    ):
        self.call_id = call_id
        self.stt_tasks = stt_tasks
        self.storage = storage
        self.webhook = webhook
        self.room = room
        self.conversation_store = conversation_store
        self.additional_storages: List[TranscriptionStorage] = additional_storages or []

        # Idempotency: cleanup can be triggered from multiple paths (empty room,
        # SIGTERM shutdown callback, entrypoint finally). Only run once; concurrent
        # callers await the first run instead of flushing/notifying again.
        self._cleanup_lock = asyncio.Lock()
        self._has_run = False

    async def run(self, reason: str = "unspecified"):
        """
        Execute full cleanup sequence with hard deadline.

        Idempotent: safe to call from the empty-room handler, the LiveKit shutdown
        callback, and the entrypoint finally block. Only the first call performs
        the flush/notify/drain work; later callers return immediately once it is done.

        Args:
            reason: Why cleanup was triggered (e.g. "room_empty", "shutdown:sigterm").
        """
        async with self._cleanup_lock:
            if self._has_run:
                logger.info("cleanup_skipped_already_run", extra={"reason": reason})
                return
            self._has_run = True

            await self._run_with_deadline(reason)

    async def _run_with_deadline(self, reason: str):
        logger.info("cleanup_started", extra={"timeout_s": 30, "reason": reason})
        # Track which steps completed so the timeout log is actionable.
        self._flush_completed = False
        self._notify_completed = False
        self._drain_completed = False

        try:
            await asyncio.wait_for(self._run_cleanup_steps(), timeout=30.0)
            logger.info(f"cleanup_completed | success=true")
        except asyncio.TimeoutError:
            logger.error(f"cleanup_timeout_exceeded | forcing_disconnect=true")
            await self._force_disconnect()
        finally:
            # Drain in-memory transcript buffers for this call (ended or failed) so they
            # don't linger until GC. Runs after flushes have uploaded, on every path.
            self._release_storage_memory()

    def _release_storage_memory(self):
        """Release in-memory transcript buffers for this call (ended or failed) so they
        don't linger until GC. Runs after cleanup regardless of success / timeout / exception."""
        try:
            self.storage.release()
            for extra in self.additional_storages:
                extra.release()
            logger.info("storage_memory_released", extra={"call_id": self.call_id})
        except Exception:
            logger.error("storage_memory_release_failed", exc_info=True)

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
            logger.info(f"stt_drain_started | pending_tasks={len(pending_tasks)}")
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending_tasks, return_exceptions=True),
                    timeout=10.0,
                )
            except asyncio.TimeoutError:
                logger.warning(f"stt_drain_timeout | cancelling_remaining=true")
                for task in pending_tasks:
                    if not task.done():
                        task.cancel()
        
        # Flush any remaining transcripts from pending STT
        try:
            await self.storage.flush()
            logger.info(f"storage_flush_completed | stage=post_stt_drain")
        except Exception:
            logger.error(f"storage_flush_failed | stage=post_stt_drain", exc_info=True)
        
        # Notify backend again if we had pending STT (transcript updated)
        if pending_tasks:
            try:
                await self.webhook.notify_transcript_ready(self.call_id)
                logger.info(f"backend_webhook_retry | reason=transcript_updated")
            except Exception:
                logger.error(f"backend_webhook_failed | stage=retry", exc_info=True)

    async def _flush_storage(self):
        try:
            await self.storage.flush()
            logger.info(f"storage_flush_completed | stage=initial")
        except Exception:
            logger.error(f"storage_flush_failed | stage=initial", exc_info=True)

        for extra in self.additional_storages:
            try:
                await extra.flush()
                logger.info(f"additional_storage_flush_completed | call_id={extra.call_id}")
            except Exception:
                logger.error(f"additional_storage_flush_failed | call_id={extra.call_id}", exc_info=True)

    async def _notify_backend(self):
        try:
            await self.webhook.notify_transcript_ready(self.call_id)
            logger.info(f"backend_webhook_sent | endpoint=transcript-ready")
        except Exception:
            logger.error(f"backend_webhook_failed | stage=initial", exc_info=True)

    async def _cleanup_state(self):
        if not self.conversation_store:
            return

        try:
            await self.conversation_store.delete()
            await self.conversation_store.redis_client.aclose()
            logger.info(f"redis_cleanup_completed | deleted=true")
        except Exception:
            logger.error(f"redis_cleanup_failed | error=true", exc_info=True)

    async def _disconnect(self):
        try:
            await self.room.disconnect()
            logger.info(f"room_disconnect_completed | graceful=true")
        except Exception:
            logger.error(f"room_disconnect_failed | error=true", exc_info=True)

    async def _force_disconnect(self):
        try:
            await asyncio.wait_for(self.room.disconnect(), timeout=2.0)
            logger.warning(f"force_disconnect_completed | reason=timeout")
        except Exception:
            logger.error(f"force_disconnect_failed | error=true", exc_info=True)
