"""Transcription deduplication logic"""
from typing import Dict
from collections import OrderedDict


class TranscriptionDeduplicator:
    """Prevents duplicate processing of transcription events
    
    Uses participant_identity + spoken_at timestamp + text prefix as unique key.
    Maintains a bounded FIFO cache of seen events (max 1000 entries).
    """
    
    def __init__(self, max_size: int = 1000):
        """Initialize deduplicator
        
        Args:
            max_size: Maximum number of events to track before cleanup
        """
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._max_size = max_size
    
    def is_duplicate(self, event: Dict) -> bool:
        """Check if we've already processed this transcription event
        
        Args:
            event: Transcription event dict with participant_identity, spoken_at, text
        
        Returns:
            True if this is a duplicate event, False otherwise
        """
        # Extract key components
        participant_id = event.get("participant_identity", "unknown")
        spoken_at = event.get("spoken_at", event.get("timestamp", 0))
        text = event.get("text", "")
        
        # Create unique event key (rounded spoken_at to handle float precision)
        event_key = f"{participant_id}:{int(spoken_at * 1000)}:{text[:50]}"
        
        # Check if seen
        if event_key in self._seen:
            return True
        
        # Mark as seen
        self._seen[event_key] = None
        
        # Limit set size to prevent memory growth
        if len(self._seen) > self._max_size:
            # Remove oldest half of entries (FIFO eviction)
            for _ in range(self._max_size // 2):
                self._seen.popitem(last=False)
        
        return False
    
    def reset(self):
        """Clear all seen events"""
        self._seen.clear()
