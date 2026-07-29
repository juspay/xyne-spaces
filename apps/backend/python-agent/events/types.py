"""
Typed event definitions for event bus
"""
from dataclasses import dataclass
from typing import Literal, Optional


@dataclass
class TranscriptionEvent:
    """
    Transcription event emitted when speech is recognized.
    
    Attributes:
        user: Display name of speaker
        text: Transcribed text
        timestamp: Event timestamp (seconds since epoch)
        participant_identity: LiveKit participant identity
        source: Event source (user speech or AI response)
        spoken_at: When the speech actually occurred (for chronological ordering)
    """
    user: str
    text: str
    timestamp: float
    participant_identity: str
    source: Literal["user", "ai"] = "user"
    spoken_at: Optional[float] = None
    
    def __post_init__(self):
        """Set spoken_at to timestamp if not provided"""
        if self.spoken_at is None:
            self.spoken_at = self.timestamp
    
    def to_dict(self) -> dict:
        """Convert to dictionary for backward compatibility"""
        return {
            "user": self.user,
            "text": self.text,
            "timestamp": self.timestamp,
            "participant_identity": self.participant_identity,
            "source": self.source,
            "spoken_at": self.spoken_at,
        }
