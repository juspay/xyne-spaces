"""
Call context - encapsulates all call-level state
"""
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class CallContext:
    """
    Unified context for a single call/room.
    
    Encapsulates all call-level metadata, eliminating the need
    to pass call_id, room_context, and participant_map separately.
    """
    call_id: str
    safe_call_id: str
    channel_id: Optional[str] = None
    board_id: Optional[str] = None
    project_id: Optional[str] = None
    backend_url: Optional[str] = None
    api_key: Optional[str] = None
    participant_map: Dict[str, str] = field(default_factory=dict)
    
    def to_room_context(self) -> dict:
        """
        Convert to room_context dict (for backward compatibility with tools).
        
        Returns:
            Room context dictionary
        """
        return {
            "call_id": self.call_id,
            "channel_id": self.channel_id,
            "board_id": self.board_id,
            "project_id": self.project_id,
            "backend_url": self.backend_url,
            "api_key": self.api_key,
            "participant_map": self.participant_map,
        }
    
    def add_participant(self, name: str, identity: str):
        """Add participant to map"""
        self.participant_map[name] = identity
    
    def is_valid_for_tools(self) -> bool:
        """Check if context has required fields for tool use"""
        return bool(
            self.channel_id and
            self.board_id and
            self.backend_url and
            self.api_key
        )
