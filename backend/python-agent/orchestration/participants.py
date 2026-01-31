"""
Participant tracking for room lifecycle
"""
import logging
from typing import Set

from livekit import rtc

logger = logging.getLogger(__name__)


class ParticipantTracker:
    """Tracks active participants in the room (excluding the agent itself)"""

    def __init__(self):
        self.active_participants: Set[str] = set()

    def add(self, participant: rtc.RemoteParticipant):
        self.active_participants.add(participant.sid)
        participant_name = participant.name or participant.identity
        logger.info(
            "Participant joined: %s (identity=%s)",
            participant_name,
            participant.identity,
        )

    def remove(self, participant: rtc.RemoteParticipant):
        self.active_participants.discard(participant.sid)
        participant_name = participant.name or participant.identity
        logger.info(
            "Participant left: %s (identity=%s)",
            participant_name,
            participant.identity,
        )

    def is_empty(self) -> bool:
        return not self.active_participants

    def initialize_from_room(self, room: rtc.Room):
        for participant in room.remote_participants.values():
            self.active_participants.add(participant.sid)
