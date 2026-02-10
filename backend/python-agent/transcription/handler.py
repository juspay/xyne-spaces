"""
Transcription event handler - coordinates all transcription processing
"""
import logging
from typing import Optional

from .publisher import LiveKitPublisher
from .storage import TranscriptionStorage
from .dedup import TranscriptionDeduplicator
from history import ConversationStore
from ai import AISessionManager
from config import get_logger

logger = get_logger(__name__)


class TranscriptionHandler:
    """
    Orchestrates transcription event processing.
    
    Responsibilities:
    - Deduplication check
    - Publish to LiveKit room
    - Store locally and to GCS
    - Store in Redis for conversation history
    - Route to AI manager for LLM processing
    """
    
    def __init__(
        self,
        publisher: LiveKitPublisher,
        storage: TranscriptionStorage,
        deduplicator: TranscriptionDeduplicator,
        conversation_store: Optional[ConversationStore] = None,
        ai_manager: Optional[AISessionManager] = None,
        call_id: str = "unknown",
    ):
        """
        Initialize transcription handler.
        
        Args:
            publisher: LiveKit publisher for room data messages
            storage: Transcription storage (local + GCS)
            deduplicator: Deduplication checker
            conversation_store: Redis conversation store
            ai_manager: AI session manager
        """
        self.publisher = publisher
        self.storage = storage
        self.deduplicator = deduplicator
        self.conversation_store = conversation_store
        self.ai_manager = ai_manager
        self._call_id = call_id
    
    async def handle(self, data: dict):
        """
        Handle transcription event through full processing pipeline.
        
        Args:
            data: Transcription event data
        """
        # 1. Deduplication check
        if self.deduplicator.is_duplicate(data):
            logger.debug(f"duplicate_transcription_skipped | participant_id={data.get('participant_identity')}, text_hash={hash(data.get('text', '')[:30])}")
            return
        
        user = data.get("user", "unknown")
        text = data.get("text", "")[:50]
        participant_id = data.get('participant_identity')
        logger.info(f"transcription_event_received | participant_id={participant_id}, user={user}, text_length={len(data.get('text', ''))}")
        logger.debug(f"transcription_processing_started | participant_id={participant_id}, text_preview={text}")
        
        # 2. Publish to LiveKit room
        await self.publisher.publish(data)
        logger.debug(f"transcription_published | participant_id={participant_id}")
        
        # 3. Store locally and to GCS
        await self.storage.write(data)
        logger.debug(f"transcription_stored | participant_id={participant_id}, storage_type=gcs")
        
        # 4. Store in Redis for conversation history (user messages only)
        is_ai_transcript = data.get("source") == "ai" or data.get("user") == "Xyne Automatic"
        if self.conversation_store is not None:
            if not is_ai_transcript:
                conversation_entry = {
                    "user": data.get("user"),
                    "text": data.get("text"),
                    "timestamp": data.get("timestamp"),
                    "spoken_at": data.get("spoken_at", data.get("timestamp")),
                    "participant_identity": data.get("participant_identity"),
                    "role": "user"
                }
                await self.conversation_store.add_entry(conversation_entry)
                logger.debug(f"conversation_entry_added | participant_id={participant_id}")
            else:
                logger.debug(f"ai_message_skipped_from_redis | participant_id={participant_id}, source=ai")
        
        # 5. Route to AI manager for LLM processing
        if self.ai_manager is not None:
            ai_enabled = self.ai_manager.ai_voice_enabled if hasattr(self.ai_manager, 'ai_voice_enabled') else False
            is_controller = self.ai_manager.controller_participant_id == data.get('participant_identity') if hasattr(self.ai_manager, 'controller_participant_id') else False
            logger.debug(f"transcription_routed_to_ai | participant_id={data.get('participant_identity')}, ai_enabled={ai_enabled}, is_controller={is_controller}")
            await self.ai_manager.handle_transcription(data)
