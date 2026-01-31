"""
LiveKit data message publisher
"""
import json
import logging
from livekit import rtc

logger = logging.getLogger(__name__)


class LiveKitPublisher:
    """Publishes transcription events to LiveKit room as data messages"""
    
    def __init__(self, room: rtc.Room):
        """
        Initialize publisher.
        
        Args:
            room: LiveKit room instance
        """
        self.room = room
    
    async def publish(self, event: dict):
        """
        Publish transcription event to room.
        
        Args:
            event: Transcription event data
        """
        try:
            logger.debug("Publishing transcription to room topic='transcriptions'")
            await self.room.local_participant.publish_data(
                json.dumps(event).encode("utf-8"),
                topic="transcriptions",
                reliable=True,
            )
        except Exception as e:
            logger.error(f"Error publishing transcription: {e}")
    
    async def publish_action(self, event: dict, controller_id: str = None):
        """
        Publish AI action event to specific participant (controller only).
        
        Args:
            event: AI action event data (e.g., INVITE_USER action)
            controller_id: Controller participant ID to target
        """
        try:
            if not controller_id:
                logger.warning("No controller_id provided, skipping AI action broadcast")
                return
            
            # Check if controller is still in the room
            controller_participant = None
            for identity, participant in self.room.remote_participants.items():
                if identity == controller_id:
                    controller_participant = participant
                    break
            
            if not controller_participant:
                logger.error(f"Controller participant {controller_id} not found in room")
                return
            
            logger.info(
                f"Publishing AI action to controller only: {event.get('action')} -> {controller_id}"
            )
            
            # Send data message to specific participant only (not broadcast)
            await self.room.local_participant.publish_data(
                json.dumps(event).encode("utf-8"),
                topic="ai-actions",
                reliable=True,
                destination_identities=[controller_id],  # KEY: Target only controller
            )
        except Exception as e:
            logger.error(f"Error publishing AI action: {e}")
