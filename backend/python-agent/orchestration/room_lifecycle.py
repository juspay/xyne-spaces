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
from config import get_logger

logger = get_logger(__name__)


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
        self._call_id = call_context.call_id
        
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
            logger.info(f"participant_joined | participant_id={participant.identity}, participant_name={participant_name}, total_participants={len(self.tracker.get_all())}")
            
            # Send current AI controller state to the new joiner
            if self.ai_manager:
                controller_info = self.ai_manager.get_controller_info()
                if controller_info.get("controller_id"):
                    logger.info(f"controller_state_transferred_to_joiner | joiner_id={participant.identity}, controller_id={controller_info.get('controller_id')}")
                asyncio.create_task(self.ai_manager.send_controller_state_to_participant(participant.identity))

        @self.ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):  # pyright: ignore[reportUnusedFunction]
            self.tracker.remove(participant)
            participant_name = participant.name or participant.identity
            remaining = len(self.tracker.active_participants)
            logger.info(f"participant_left | participant_id={participant.identity}, participant_name={participant_name}, remaining_participants={remaining}")
            
            # Check if this participant was the AI controller and release control
            if self.ai_manager:
                controller_info = self.ai_manager.get_controller_info()
                if controller_info.get("controller_id") == participant.identity:
                    logger.info(f"ai_controller_left | participant_id={participant.identity}, participant_name={participant_name}, releasing_control=true")
                    asyncio.create_task(self.ai_manager.release_control())

            if self.tracker.is_empty():
                logger.info(f"room_empty | trigger_reason=all_participants_left")
                asyncio.create_task(self.cleanup_manager.run(reason="room_empty"))

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
        
        # MultiUserTranscriber event handlers will be registered in main.py after agent is fully ready
        if self.multi_user_transcriber is not None:
            logger.info(f"room_lifecycle_initialized | initial_participants={len(self.tracker.active_participants)}")

    def get_stt_tasks(self) -> Dict[str, asyncio.Task]:
        return self.stt_tasks
    
    async def cleanup(self):
        """Clean up transcription resources."""
        if self.multi_user_transcriber is not None:
            await self.multi_user_transcriber.aclose()
            logger.info(f"transcriber_cleanup_completed")
        return self.stt_tasks
