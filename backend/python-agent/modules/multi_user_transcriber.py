"""
MultiUserTranscriber - Built-in STT with AgentSession per participant

Uses livekit-agents built-in STT with:
- silero.VAD for voice activity detection (with pre-buffering)
- openai.STT.with_azure() for Azure OpenAI Whisper transcription
- One AgentSession per participant for proper audio isolation
- Retry logic for handling transient errors
"""
import asyncio
import logging
import time
from typing import Dict, Optional, Callable, Awaitable

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    StopResponse,
    llm,
    room_io,
    stt,
)
from livekit.plugins import openai, silero

from events import EventBus
from config import get_logger

logger = get_logger(__name__)


class ResilientSTT(stt.STT):
    """
    STT wrapper with retry logic for handling transient errors.
    
    Retries on network errors, timeouts, and other temporary failures.
    """
    
    def __init__(
        self, 
        inner_stt: stt.STT,
        max_retries: int = 3,
        base_delay: float = 1.0,
    ):
        """
        Initialize the resilient STT wrapper.
        
        Args:
            inner_stt: The actual STT implementation to wrap
            max_retries: Maximum number of retry attempts
            base_delay: Base delay in seconds for exponential backoff
        """
        super().__init__(
            capabilities=inner_stt.capabilities,
        )
        self._inner_stt = inner_stt
        self._max_retries = max_retries
        self._base_delay = base_delay
    
    async def _recognize_impl(
        self,
        buffer,
        *,
        language=None,
        conn_options=None,
    ) -> stt.SpeechEvent:
        """
        Recognize speech with retry on transient errors.
        """
        last_error = None
        
        for attempt in range(self._max_retries):
            try:
                return await self._inner_stt._recognize_impl(
                    buffer, 
                    language=language,
                    conn_options=conn_options,
                )
            except Exception as e:
                last_error = e
                error_str = str(e)
                
                # Don't retry on certain errors (e.g., authentication, invalid input)
                if any(err in error_str.lower() for err in ["unauthorized", "invalid", "authentication"]):
                    logger.error(f"STT_RECOGNITION_FAILED_NON_RETRYABLE | error={e}, error_type=auth")
                    raise
                
                # For other errors (network, timeout, temporary), retry
                if attempt < self._max_retries - 1:
                    delay = self._base_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        f"STT_RECOGNITION_RETRY | attempt={attempt + 1}, total_attempts={self._max_retries}, "
                        f"error={e}, next_retry_delay={delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"STT_RECOGNITION_ALL_RETRIES_FAILED | attempts={self._max_retries}, last_error={e}")
        
        # All retries exhausted
        raise last_error


class ParticipantTranscriber(Agent):
    """
    Agent that handles transcription for a single participant.
    
    Uses built-in STT and emits transcription events via callback.
    """
    
    def __init__(
        self,
        *,
        participant_identity: str,
        participant_name: str,
        on_transcription: Callable[[dict], Awaitable[None]],
        call_id: str = "unknown",
    ):
        """
        Initialize the transcriber agent.
        
        Args:
            participant_identity: The participant's identity (for backend lookup)
            participant_name: The participant's display name
            on_transcription: Async callback to emit transcription events
            call_id: Call ID for logging
        """
        super().__init__(
            instructions="not-needed",  # We're only transcribing, not generating responses
        )
        self.participant_identity = participant_identity
        self.participant_name = participant_name
        self._on_transcription = on_transcription
        self._call_id = call_id
    
    async def on_user_turn_completed(
        self, 
        chat_ctx: llm.ChatContext, 
        new_message: llm.ChatMessage
    ):
        """
        Called when a user finishes speaking and transcription is complete.
        
        Args:
            chat_ctx: Chat context (not used for transcription-only)
            new_message: The transcribed message
        """
        user_transcript = new_message.text_content
        
        if not user_transcript or not user_transcript.strip():
            raise StopResponse()
        
        # Emit transcription event (same format as ear.py)
        await self._on_transcription({
            "user": self.participant_name,
            "text": user_transcript,
            "timestamp": time.time(),
            "spoken_at": time.time(),  # Built-in STT doesn't expose exact speech time
            "participant_identity": self.participant_identity,
        })
        
        # Log transcription generated (Phase 2.1.16)
        logger.info(f"transcription_generated | participant_id={self.participant_identity}, text_preview={user_transcript[:50]}...")
        
        # Stop response generation - we're only transcribing
        raise StopResponse()


class MultiUserTranscriber:
    """
    Manages transcription for multiple participants in a room.
    
    Creates one AgentSession per participant for proper audio isolation.
    Uses built-in VAD and STT for reliable speech detection and transcription.
    """
    
    def __init__(
        self,
        ctx: JobContext,
        event_bus: EventBus,
        *,
        # Azure OpenAI STT Configuration
        azure_endpoint: str,
        azure_api_key: str,
        azure_api_version: str,
        azure_deployment: str,
        # VAD Configuration
        vad_activation_threshold: float = 0.5,
        vad_min_speech_duration: float = 0.1,
        vad_min_silence_duration: float = 0.5,
        vad_prefix_padding_duration: float = 0.5,  # Pre-buffer to capture speech onset
        # AI Session for interruption (optional)
        agent_session: Optional[AgentSession] = None,
        # Call ID for logging
        call_id: str = "unknown",
    ):
        """
        Initialize the multi-user transcriber.
        
        Args:
            ctx: JobContext from livekit-agents
            event_bus: EventBus for emitting transcription events
            azure_endpoint: Azure OpenAI endpoint URL
            azure_api_key: Azure OpenAI API key
            azure_api_version: Azure OpenAI API version
            azure_deployment: Azure OpenAI Whisper deployment name
            vad_activation_threshold: VAD sensitivity (0.0-1.0, higher = less sensitive)
            vad_min_speech_duration: Minimum speech duration to trigger detection
            vad_min_silence_duration: Minimum silence before end of speech
            vad_prefix_padding_duration: Audio buffer before VAD triggers (fixes clipping)
            agent_session: Optional main AgentSession for AI interruption
        """
        self.ctx = ctx
        self.bus = event_bus
        self.agent_session = agent_session
        
        # Azure STT configuration
        self._azure_endpoint = azure_endpoint
        self._azure_api_key = azure_api_key
        self._azure_api_version = azure_api_version
        self._azure_deployment = azure_deployment
        
        # VAD configuration
        self._vad_activation_threshold = vad_activation_threshold
        self._vad_min_speech_duration = vad_min_speech_duration
        self._vad_min_silence_duration = vad_min_silence_duration
        self._vad_prefix_padding_duration = vad_prefix_padding_duration
        
        # Session management
        self._sessions: Dict[str, AgentSession] = {}
        self._tasks: set[asyncio.Task] = set()
        self._call_id = call_id
        
        # Pre-load VAD model for faster session startup
        self._vad: Optional[silero.VAD] = None
        
        # Shared resilient STT with retry logic
        self._shared_stt: Optional[ResilientSTT] = None
        
        logger.info(
            f"multi_user_transcriber_initialized | "
            f"vad_threshold={vad_activation_threshold}, min_speech={vad_min_speech_duration}s, "
            f"min_silence={vad_min_silence_duration}s, prefix_padding={vad_prefix_padding_duration}s"
        )
    
    def _create_stt(self) -> ResilientSTT:
        """Create or reuse shared resilient STT instance."""
        if self._shared_stt is None:
            stt_prompt = "The following technical discussion includes terms like Xyne Calls, Juspay Euler, Namma Cloud, Xyne Chats, Xyne Tickets, Juspay Hyperswitch, Xyne Support, Namma Yatri, Xyne Spaces, Juspay,  Xyne Code, Xyne Training, Namma Bengaluru, Xyne Automatic, Juspay Payments Operating System, Xyne AI, Xyne Assistant, Namma Shuttle, Xyne Agent, Xyne Bot, Juspay Technologies, Namma Switch, Xyne The speaker begins by saying:"
            inner_stt = openai.STT.with_azure(
                azure_endpoint=self._azure_endpoint,
                azure_deployment=self._azure_deployment,
                api_version=self._azure_api_version,
                api_key=self._azure_api_key,
                prompt=stt_prompt
            )
            self._shared_stt = ResilientSTT(
                inner_stt=inner_stt,
                max_retries=3,
                base_delay=1.0,
            )
            logger.info(f"resilient_stt_created | model=gpt-4o-transcribe, max_retries=3, base_delay=1.0")
        return self._shared_stt
    
    def _create_vad(self) -> silero.VAD:
        """Create or reuse VAD instance."""
        if self._vad is None:
            self._vad = silero.VAD.load(
                activation_threshold=self._vad_activation_threshold,
                min_speech_duration=self._vad_min_speech_duration,
                min_silence_duration=self._vad_min_silence_duration,
                prefix_padding_duration=self._vad_prefix_padding_duration,
            )
            logger.info(f"vad_model_loaded | activation_threshold={self._vad_activation_threshold}, min_speech={self._vad_min_speech_duration}, min_silence={self._vad_min_silence_duration}")
        return self._vad
    
    async def _emit_transcription(self, data: dict):
        """Emit transcription event via EventBus."""
        await self.bus.emit("TRANSCRIPTION", data)
    
    def start(self):
        """Register room event handlers."""
        self.ctx.room.on("participant_connected", self._on_participant_connected)
        self.ctx.room.on("participant_disconnected", self._on_participant_disconnected)
        logger.info(f"transcriber_started")
    
    async def aclose(self):
        """Clean up all sessions and tasks."""
        # Cancel pending tasks
        await asyncio.gather(
            *[self._cancel_task(task) for task in self._tasks],
            return_exceptions=True
        )
        self._tasks.clear()
        
        # Close all sessions
        await asyncio.gather(
            *[self._close_session(session) for session in self._sessions.values()],
            return_exceptions=True
        )
        self._sessions.clear()
        
        # Remove event listeners
        self.ctx.room.off("participant_connected", self._on_participant_connected)
        self.ctx.room.off("participant_disconnected", self._on_participant_disconnected)
        
        logger.info(f"all_transcriber_sessions_closed | sessions_count={len(self._sessions)}")
    
    async def _cancel_task(self, task: asyncio.Task):
        """Cancel a task gracefully."""
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    
    def _on_participant_connected(self, participant: rtc.RemoteParticipant):
        """Handle new participant connection."""
        if participant.identity in self._sessions:
            logger.debug(f"participant_session_already_exists | participant_id={participant.identity}")
            return
        
        participant_name = participant.name or participant.identity
        logger.info(f"participant_session_starting | participant_id={participant.identity}, participant_name={participant_name}")
        
        task = asyncio.create_task(self._start_session(participant))
        self._tasks.add(task)
        
        def on_task_done(t: asyncio.Task):
            try:
                session = t.result()
                self._sessions[participant.identity] = session
                logger.info(f"participant_session_started | participant_id={participant.identity}, participant_name={participant_name}")
            except Exception as e:
                logger.error(f"participant_session_failed | participant_id={participant.identity}, error={e}")
            finally:
                self._tasks.discard(t)
        
        task.add_done_callback(on_task_done)
    
    def _on_participant_disconnected(self, participant: rtc.RemoteParticipant):
        """Handle participant disconnection."""
        session = self._sessions.pop(participant.identity, None)
        if session is None:
            return
        
        participant_name = participant.name or participant.identity
        logger.info(f"participant_disconnected | participant_id={participant.identity}, participant_name={participant_name}")
        
        task = asyncio.create_task(self._close_session(session))
        self._tasks.add(task)
        task.add_done_callback(lambda t: self._tasks.discard(t))
    
    async def _start_session(self, participant: rtc.RemoteParticipant) -> AgentSession:
        """
        Create and start an AgentSession for a participant.
        
        Args:
            participant: The remote participant to transcribe
            
        Returns:
            The started AgentSession
        """
        participant_name = participant.name or participant.identity
        
        # Create session with VAD and STT
        session = AgentSession(
            vad=self._create_vad(),
            stt=self._create_stt(),
        )
        
        # Create agent for this participant
        agent = ParticipantTranscriber(
            participant_identity=participant.identity,
            participant_name=participant_name,
            on_transcription=self._emit_transcription,
            call_id=self._call_id,
        )
        
        # Start session with participant-specific options
        await session.start(
            agent=agent,
            room=self.ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=True,
                text_output=True,  # Publish transcriptions to room
                audio_output=False,  # Don't generate audio responses
                participant_identity=participant.identity,  # Link to specific participant
                # Text input not supported for multiple participants
                text_input=False,
            ),
        )
        
        return session
    
    async def _close_session(self, session: AgentSession):
        """
        Close an AgentSession gracefully.

        Args:
            session: The session to close
        """
        try:
            logger.info(f"stt_drain_started")
            await session.drain()
            logger.info(f"stt_drain_completed")
            await session.aclose()
        except asyncio.TimeoutError:
            logger.warning(f"stt_drain_timeout")
        except Exception as e:
            logger.warning(f"participant_session_close_error | error={e}")
    
    def handle_existing_participants(self):
        """Start sessions for participants already in the room."""
        for participant in self.ctx.room.remote_participants.values():
            self._on_participant_connected(participant)
    
    def set_agent_session(self, agent_session: AgentSession):
        """
        Set the main AI AgentSession for interruption handling.
        
        Note: Built-in VAD in each transcription session should handle
        interruption automatically, but this allows additional coordination.
        
        Args:
            agent_session: The main AI AgentSession
        """
        self.agent_session = agent_session
        logger.info(f"transcriber_linked_to_ai")
