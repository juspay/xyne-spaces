"""
LiveKit room lifecycle management
"""
import asyncio
import logging
from typing import Dict, Optional, Union

from livekit import rtc
from livekit.agents import JobContext

from .participants import ParticipantTracker
from .cleanup import CleanupManager
from modules import EarModule, MultiUserTranscriber
from domain import CallContext

logger = logging.getLogger(__name__)


class RoomLifecycle:
    """
    Manages LiveKit room lifecycle events.
    """

    def __init__(
        self,
        ctx: JobContext,
        tracker: ParticipantTracker,
        cleanup_manager: CleanupManager,
        call_context: CallContext,
        # Support both old EarModule and new MultiUserTranscriber
        ear_module: Optional[EarModule] = None,
        multi_user_transcriber: Optional[MultiUserTranscriber] = None,
        ai_manager=None,
    ):
        self.ctx = ctx
        self.tracker = tracker
        self.cleanup_manager = cleanup_manager
        self.call_context = call_context
        self.ai_manager = ai_manager
        
        # Support both transcription approaches
        self.ear_module = ear_module
        self.multi_user_transcriber = multi_user_transcriber
        
        # Only used with EarModule (legacy)
        self.stt_tasks: Dict[str, asyncio.Task] = {}

    def register_handlers(self):
        @self.ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):  # pyright: ignore[reportUnusedFunction]
            self.tracker.add(participant)
            participant_name = participant.name or participant.identity
            self.call_context.add_participant(participant_name, participant.identity)
            
            # Send current AI controller state to the new joiner
            if self.ai_manager:
                asyncio.create_task(self.ai_manager.send_controller_state_to_participant(participant.identity))

        @self.ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):  # pyright: ignore[reportUnusedFunction]
            self.tracker.remove(participant)
            participant_name = participant.name or participant.identity
            
            # Check if this participant was the AI controller and release control
            if self.ai_manager:
                controller_info = self.ai_manager.get_controller_info()
                if controller_info.get("controller_id") == participant.identity:
                    logger.info(f"Controller {participant_name} left, releasing AI control")
                    asyncio.create_task(self.ai_manager.release_control())

            if self.tracker.is_empty():
                logger.info("Room empty, triggering cleanup")
                asyncio.create_task(self.cleanup_manager.run())

        # Only register track_subscribed handler if using legacy EarModule
        # MultiUserTranscriber handles track subscription internally
        if self.ear_module is not None:
            @self.ctx.room.on("track_subscribed")
            def on_track_subscribed(  # pyright: ignore[reportUnusedFunction]
                track: rtc.Track,
                publication: rtc.TrackPublication,
                participant: rtc.RemoteParticipant,
            ):
                if track.kind != rtc.TrackKind.KIND_AUDIO:
                    return

                if isinstance(track, rtc.RemoteAudioTrack):
                    task = asyncio.create_task(
                        self.ear_module.listen(participant, track)
                    )
                    self.stt_tasks[participant.sid] = task
        
        # Start MultiUserTranscriber if using new approach
        if self.multi_user_transcriber is not None:
            self.multi_user_transcriber.start()
            # Handle existing participants already in the room
            self.multi_user_transcriber.handle_existing_participants()
            logger.info("[RoomLifecycle] MultiUserTranscriber started")

    def get_stt_tasks(self) -> Dict[str, asyncio.Task]:
        return self.stt_tasks
    
    async def cleanup(self):
        """Clean up transcription resources."""
        if self.multi_user_transcriber is not None:
            await self.multi_user_transcriber.aclose()
            logger.info("[RoomLifecycle] MultiUserTranscriber closed")
        return self.stt_tasks
