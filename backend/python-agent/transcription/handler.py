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

logger = logging.getLogger(__name__)


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
    
    async def handle(self, data: dict):
        """
        Handle transcription event through full processing pipeline.
        
        Args:
            data: Transcription event data
        """
        # 1. Deduplication check
        if self.deduplicator.is_duplicate(data):
            logger.debug("[HANDLER] Skipping duplicate transcription event")
            return
        
        logger.info(
            "[HANDLER] Processing transcription event",
            extra={"user": data.get("user"), "text": data.get("text")}
        )
        
        # 2. Publish to LiveKit room
        await self.publisher.publish(data)
        
        # 3. Store locally and to GCS
        await self.storage.write(data)
        
        # 4. Store in Redis for conversation history (user messages only)
        is_ai_transcript = data.get("source") == "ai" or data.get("user") == "Xyne Automatic"
        if self.conversation_store is not None and not is_ai_transcript:
            conversation_entry = {
                "user": data.get("user"),
                "text": data.get("text"),
                "timestamp": data.get("timestamp"),
                "spoken_at": data.get("spoken_at", data.get("timestamp")),
                "participant_identity": data.get("participant_identity"),
                "role": "user"
            }
            await self.conversation_store.add_entry(conversation_entry)
        
        # 5. Route to AI manager for LLM processing
        if self.ai_manager is not None:
            await self.ai_manager.handle_transcription(data)
