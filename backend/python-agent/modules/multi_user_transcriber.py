"""
MultiUserTranscriber - Built-in STT with AgentSession per participant

Uses livekit-agents built-in STT with:
- silero.VAD for voice activity detection (with pre-buffering)
- openai.STT.with_azure() for Azure OpenAI Whisper transcription
- google.STT() for Google Cloud Speech-to-Text transcription
- LiveKit Turn Detector for contextually-aware end-of-turn detection
- One AgentSession per participant for proper audio isolation
- Retry logic for handling transient errors
"""
import asyncio
import json
import logging
import os
import time
from typing import Dict, Optional, Callable, Awaitable, Set, Any

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
from livekit.plugins import openai, silero, google
from livekit.plugins import deepgram
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from events import EventBus
from config import get_logger

logger = get_logger(__name__)


def _load_turn_detector_model():
    """
    Load the multilingual turn detector model.
    Models download automatically and cache in /app/.cache/huggingface.
    
    Returns None if loading fails, allowing graceful fallback to VAD-based detection.
    """
    try:
        model = MultilingualModel()
        logger.info("✓ Turn Detector loaded - context-aware end-of-turn detection enabled")
        return model
    except RuntimeError as e:
        if "no job context found" in str(e):
            logger.info("Turn Detector will initialize when job context is available")
        else:
            logger.error(f"Failed to load Turn Detector: {e}")
        return None
    except Exception as e:
        logger.warning(f"Turn Detector unavailable: {e}. Using VAD-based detection.")
        return None

class ResilientSTT(stt.STT):
    """
    STT wrapper with retry logic for handling transient errors.
    Retries on network errors, timeouts, and other temporary failures.
    Note: For streaming, we delegate directly to the inner STT since
    retry logic for streams is complex and best handled by the underlying provider.
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
    
    def stream(self, *, language=None, conn_options=None):
        """
        Delegate streaming directly to the inner STT.
        The inner STT (Google/Azure) handles its own reconnection logic.
        """
        if language is not None:
            return self._inner_stt.stream(language=language, conn_options=conn_options)
        else:
            return self._inner_stt.stream(conn_options=conn_options)
    
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
        ai_enabled: bool = False,
    ):
        """
        Initialize the transcriber agent.
        
        Args:
            participant_identity: The participant's identity (for backend lookup)
            participant_name: The participant's display name
            on_transcription: Async callback to emit transcription events
            call_id: Call ID for logging
            ai_enabled: Whether AI voice is enabled (affects turn detection)
        """
        turn_detector = _load_turn_detector_model()
        super().__init__(
            instructions="not-needed",
            turn_detection=turn_detector,
        )
        self.participant_identity = participant_identity
        self.participant_name = participant_name
        self._on_transcription = on_transcription
        self._call_id = call_id
        self.ai_enabled = ai_enabled
    
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
        stt_model: str = "azure",
        google_credentials_json: Optional[str] = None,
        google_stt_model: str = "chirp_3",
        google_stt_language: str = "en-US",
        # Deepgram STT Configuration
        deepgram_api_key: Optional[str] = None,
        deepgram_model: str = "nova-3",
        deepgram_language: str = "en-US",
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
            stt_model: STT provider to use ('google', 'azure', or 'deepgram', default: 'google')
            google_credentials_json: Google service account credentials JSON (for validation/logging only, actual credentials loaded from GOOGLE_APPLICATION_CREDENTIALS env var)
            google_stt_model: Google STT model name (e.g., long, latest_long, short)
            google_stt_language: Language code (e.g., en-US)
            deepgram_api_key: Deepgram API key
            deepgram_model: Deepgram model name (e.g., nova-3, flux-general-en)
            deepgram_language: Language code (e.g., en-US)
            vad_activation_threshold: VAD sensitivity (0.0-1.0, higher = less sensitive)
            vad_min_speech_duration: Minimum speech duration to trigger detection
            vad_min_silence_duration: Minimum silence before end of speech
            vad_prefix_padding_duration: Audio buffer before VAD triggers (fixes clipping)
            agent_session: Optional main AgentSession for AI interruption
        """
        self.ctx = ctx
        self.bus = event_bus
        self.agent_session = agent_session
        self._azure_endpoint = azure_endpoint
        self._azure_api_key = azure_api_key
        self._azure_api_version = azure_api_version
        self._azure_deployment = azure_deployment

        self._stt_model = stt_model.lower()
        self._google_credentials_json = google_credentials_json
        self._google_stt_model = google_stt_model
        self._google_stt_language = google_stt_language
        
        self._deepgram_api_key = deepgram_api_key
        self._deepgram_model = deepgram_model
        self._deepgram_language = deepgram_language
        
        self._vad_activation_threshold = vad_activation_threshold
        self._vad_min_speech_duration = vad_min_speech_duration
        self._vad_min_silence_duration = vad_min_silence_duration
        self._vad_prefix_padding_duration = vad_prefix_padding_duration
        
        self._sessions: Dict[str, AgentSession] = {}
        self._call_id = call_id
        self._tasks: Set[asyncio.Task] = set()
        self._agent_session: Optional[AgentSession] = None
        self._ai_manager: Optional[Any] = None
        self._call_type: Optional[str] = None
        self._stt_model_override: Optional[str] = None  # User's STT model preference from UI
        self._mute_states: Dict[str, bool] = {}  # Track mute state per participant
        
        # Pre-load VAD model for faster session startup
        self._vad: Optional[silero.VAD] = None
        
        # Shared resilient STT with retry logic
        self._shared_stt: Optional[ResilientSTT] = None
        logger.info(
            f"multi_user_transcriber_initialized | "
            f"vad_threshold={vad_activation_threshold}, min_speech={vad_min_speech_duration}s, "
            f"min_silence={vad_min_silence_duration}s, prefix_padding={vad_prefix_padding_duration}s"
        )
        

    
    
    def _create_google_stt_instance(self) -> google.STT:
        """
        Helper to create Google STT instance.
        
        Credentials file path is read from GOOGLE_APPLICATION_CREDENTIALS
        environment variable (secure temp file created in main.py at startup).
        """
        language_codes = [lang.strip() for lang in self._google_stt_language.split(',')]
        
        # Get credentials file path from environment
        credentials_file = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        if not credentials_file:
            raise ValueError("GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
        
        # Create Google STT with Chirp configuration
        return google.STT(
            model=self._google_stt_model,
            languages=language_codes,
            credentials_file=credentials_file,
            location="us",
            detect_language=False,
            enable_word_confidence=False,
            min_confidence_threshold=0.5,
            sample_rate=16000,
            interim_results=True,
        )
    
    def _create_stt(self, call_type: Optional[str] = None) -> ResilientSTT:
        """
        Create or reuse shared resilient STT instance.
        For HEADLESS calls, bypass cache to allow per-call STT selection.
        """
        selected_model = self._stt_model_override or self._stt_model
        
        if self._shared_stt is None or call_type == 'HEADLESS':
            # Use Deepgram STT
            if selected_model == "deepgram" and self._deepgram_api_key:
                inner_stt = deepgram.STT(
                    model=self._deepgram_model,
                    detect_language=True,  # Auto-detect language
                    interim_results=True,
                    punctuate=True,
                    filler_words=True,
                    sample_rate=16000,
                    endpointing_ms=25,
                    api_key=self._deepgram_api_key,
                )
                resilient_stt = ResilientSTT(inner_stt=inner_stt, max_retries=3, base_delay=1.0)
                # For HEADLESS, return without caching. For regular calls, cache it.
                if call_type == 'HEADLESS':
                    return resilient_stt
                else:
                    self._shared_stt = resilient_stt
                    
            # Use Google STT
            elif selected_model == "google" and os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
                logger.info("[STT] Using Google Cloud Speech-to-Text")
                inner_stt = self._create_google_stt_instance()
                resilient_stt = ResilientSTT(inner_stt=inner_stt, max_retries=3, base_delay=1.0)
                
                if call_type == 'HEADLESS':
                    return resilient_stt
                else:
                    self._shared_stt = resilient_stt
            else:
                logger.info("[STT] Using Azure OpenAI Whisper")
                stt_prompt = "The following technical discussion includes terms like Xyne Calls, Juspay Euler, Namma Cloud, Xyne Chats, Xyne Tickets, Juspay Hyperswitch, Xyne Support, Namma Yatri, Xyne Spaces, Juspay,  Xyne Code, Xyne Training, Namma Bengaluru, Xyne Automatic, Juspay Payments Operating System, Xyne AI, Xyne Assistant, Namma Shuttle, Xyne Agent, Xyne Bot, Juspay Technologies, Namma Switch, Xyne The speaker begins by saying:"
                inner_stt = openai.STT.with_azure(
                    azure_endpoint=self._azure_endpoint,
                    azure_deployment=self._azure_deployment,
                    api_version=self._azure_api_version,
                    api_key=self._azure_api_key,
                    prompt=stt_prompt
                )
                self._shared_stt = ResilientSTT(inner_stt=inner_stt, max_retries=3, base_delay=1.0)
        return self._shared_stt
    
    def _create_vad(self) -> silero.VAD:
        """Create or reuse VAD instance with stricter settings."""
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
    
    async def start(self):
        """Start room-level monitoring with track mute/unmute event handlers."""
        try:
            # Register participant handlers
            self.ctx.room.on("participant_connected", self._on_participant_connected)
            self.ctx.room.on("participant_disconnected", self._on_participant_disconnected)
            
            # Register track mute/unmute handlers
            self.ctx.room.on("track_muted", self._on_track_muted)
            self.ctx.room.on("track_unmuted", self._on_track_unmuted)
            
            # Initialize mute states for existing participants
            for participant in self.ctx.room.remote_participants.values():
                for _, publication in participant.track_publications.items():
                    if publication.kind == rtc.TrackKind.KIND_AUDIO:
                        self._mute_states[participant.identity] = publication.muted
                        if publication.muted:
                            self.set_participant_muted(participant.identity, True)
            
            logger.info("transcriber_started | mute_detection=enabled")
        except Exception as e:
            logger.error(f"transcriber_start_failed | error={e}", exc_info=True)
    
    async def aclose(self):
        """Clean up all sessions and tasks."""
        # Cancel pending tasks
        await asyncio.gather(
            *[self._cancel_task(task) for task in self._tasks],
            return_exceptions=True
        )
        self._tasks.clear()
        
        # Close all per-participant sessions
        await asyncio.gather(
            *[self._close_session(session, identity) for identity, session in self._sessions.items()],
            return_exceptions=True
        )
        self._sessions.clear()
        self._mute_states.clear()
        
        # Unregister event handlers from ctx.room
        try:
            self.ctx.room.off("participant_connected", self._on_participant_connected)
            self.ctx.room.off("participant_disconnected", self._on_participant_disconnected)
            self.ctx.room.off("track_muted", self._on_track_muted)
            self.ctx.room.off("track_unmuted", self._on_track_unmuted)
            logger.info("room_event_handlers_unregistered")
        except Exception as e:
            logger.warning(f"room_event_handlers_unregister_error | error={e}")
        
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
        
        task = asyncio.create_task(self._close_session(session, participant.identity))
        self._tasks.add(task)
        task.add_done_callback(lambda t: self._tasks.discard(t))
    
    def _on_track_muted(self, publication, participant):
        """Handle track muted event - stops VAD processing for the participant."""
        try:
            logger.info(
                f"[MUTE-EVENT] track_muted | participant_id={participant.identity}, "
                f"participant_name={participant.name}, publication_sid={publication.sid}, "
                f"kind={publication.kind}, source={publication.source}, "
                f"is_audio={publication.kind == rtc.TrackKind.KIND_AUDIO}, "
                f"is_microphone={publication.source == rtc.TrackSource.SOURCE_MICROPHONE}"
            )
            if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.source == rtc.TrackSource.SOURCE_MICROPHONE:
                logger.info(f"[MUTE-EVENT] Condition matched - calling set_participant_muted(True) | participant={participant.name}")
                self.set_participant_muted(participant.identity, True)
            else:
                logger.info(f"[MUTE-EVENT] Condition NOT matched - skipping | participant={participant.name}")
        except Exception as e:
            logger.error(f"track_muted_error | participant_id={participant.identity}, error={e}", exc_info=True)
    
    def _on_track_unmuted(self, participant, publication):
        """Handle track unmuted event - resumes VAD processing for the participant."""
        try:
            logger.info(
                f"[UNMUTE-EVENT] track_unmuted | participant_id={participant.identity}, "
                f"participant_name={participant.name}, publication_sid={publication.sid}, "
                f"kind={publication.kind}, source={publication.source}, "
                f"is_audio={publication.kind == rtc.TrackKind.KIND_AUDIO}, "
                f"is_microphone={publication.source == rtc.TrackSource.SOURCE_MICROPHONE}"
            )
            if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.source == rtc.TrackSource.SOURCE_MICROPHONE:
                logger.info(f"[UNMUTE-EVENT] Condition matched - calling set_participant_muted(False) | participant={participant.name}")
                self.set_participant_muted(participant.identity, False)
            else:
                logger.info(f"[UNMUTE-EVENT] Condition NOT matched - skipping | participant={participant.name}")
        except Exception as e:
            logger.error(f"track_unmuted_error | participant_id={participant.identity}, error={e}", exc_info=True)
    
    async def _start_session(self, participant: rtc.RemoteParticipant) -> AgentSession:
        """
        Create and start an AgentSession for a participant.
        Args:
            participant: The remote participant to transcribe
        Returns:
            The started AgentSession
        """
        participant_name = participant.name or participant.identity
        # Create session with VAD and call-type-aware STT
        session = AgentSession(
            vad=self._create_vad(),
            stt=self._create_stt(call_type=self._call_type),  # Pass call type for STT selection
        )
        
        # Create agent for this participant
        # Use dynamic turn detection based on AI state
        agent = ParticipantTranscriber(
            participant_identity=participant.identity,
            participant_name=participant_name,
            on_transcription=self._emit_transcription,
            call_id=self._call_id,
            ai_enabled=self._is_ai_enabled(),
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
        
        # Initialize mute state and check if already muted
        self._mute_states[participant.identity] = False
        
        for _, publication in participant.track_publications.items():
            if publication.kind == rtc.TrackKind.KIND_AUDIO:
                logger.info(
                    f"[MUTE-CHECK] Initial state | participant_id={participant.identity}, "
                    f"publication.muted={publication.muted}, publication.sid={publication.sid}, "
                    f"publication.source={publication.source}"
                )
                if publication.muted:
                    self.set_participant_muted(participant.identity, True)
                break
        
        return session
    
    async def _close_session(self, session: AgentSession, participant_identity: str = None):
        """
        Close an AgentSession gracefully.

        Args:
            session: The session to close
            participant_identity: The participant's identity (for cleanup)
        """
        try:
            # Clean up mute state
            if participant_identity and participant_identity in self._mute_states:
                del self._mute_states[participant_identity]
            
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
        """Set the agent session for VAD-based speech interruption."""
        self._agent_session = agent_session
    
    def set_ai_manager(self, ai_manager: Any):
        """Set the AI manager to check AI voice state."""
        self._ai_manager = ai_manager
    
    def set_call_type(self, call_type: str):
        """Set the call type for STT selection (HEADLESS, AUDIO, VIDEO)."""
        self._call_type = call_type
    
    def set_stt_model_override(self, model: str):
        """Set user's STT model preference from UI (google or azure)."""
        self._stt_model_override = model.lower()
        logger.info(f"[MultiUserTranscriber] STT model override: {model}")
    
    def _is_ai_enabled(self) -> bool:
        """Check if AI voice is currently enabled."""
        if self._ai_manager is None:
            return False
        return getattr(self._ai_manager, 'ai_voice_enabled', False)
    
    def set_participant_muted(self, participant_identity: str, is_muted: bool):
        """Control audio input based on mute state to optimize VAD processing."""
        session = self._sessions.get(participant_identity)
        participant = self.ctx.room.remote_participants.get(participant_identity)
        participant_name = participant.name if participant else participant_identity
        
        logger.info(
            f"[SET-MUTED] Called | participant={participant_name}, "
            f"requested_muted={is_muted}, has_session={session is not None}"
        )
        
        if session is None:
            logger.warning(f"[SET-MUTED] No session found - early return | participant={participant_name}")
            return
        
        old_state = self._mute_states.get(participant_identity, False)
        logger.info(
            f"[SET-MUTED] State check | participant={participant_name}, "
            f"old_state={old_state}, new_state={is_muted}, state_changed={old_state != is_muted}"
        )
        
        if old_state != is_muted:
            self._mute_states[participant_identity] = is_muted
            session.input.set_audio_enabled(not is_muted)
            
            logger.info(
                f"mute_state_changed | participant={participant_name}, "
                f"muted={is_muted}, vad_active={not is_muted}"
            )
        else:
            logger.info(f"[SET-MUTED] State unchanged - skipping | participant={participant_name}, state={is_muted}")

