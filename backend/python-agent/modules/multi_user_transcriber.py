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
import concurrent.futures
import json
import logging
import math
import os
import time
from typing import Dict, List, Optional, Callable, Awaitable, Set, Any

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
from livekit.agents.types import NOT_GIVEN
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
        turn_detector=None,
        on_identified_transcription: Optional[Callable[[dict], Awaitable[None]]] = None,
        identifier: Optional[Any] = None,
    ):
        """
        Initialize the transcriber agent.
        
        Args:
            participant_identity: The participant's identity (for backend lookup)
            participant_name: The participant's display name
            on_transcription: Async callback to emit transcription events
            call_id: Call ID for logging
            ai_enabled: Whether AI voice is enabled (affects turn detection)
            turn_detector: Pre-loaded shared turn detector model (avoids per-participant loading)
            on_identified_transcription: Optional callback for real-name identified transcript
            identifier: Optional RealtimeIdentifier for speaker lookup
        """
        super().__init__(
            instructions="not-needed",
            turn_detection=turn_detector,
        )
        self.participant_identity = participant_identity
        self.participant_name = participant_name
        self._on_transcription = on_transcription
        self._call_id = call_id
        self.ai_enabled = ai_enabled
        self._on_identified_transcription = on_identified_transcription
        self._identifier = identifier
    
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

        # Emit identified transcription with real name if voiceprint match is available
        if self._on_identified_transcription is not None:
            # Wait briefly for the current turn's embedding to complete.
            # The identifier VAD fires at roughly the same time as AgentSession VAD.
            # Timeout is configurable via SPEAKER_ID_TIMEOUT_SECS env var (default 2s).
            if self._identifier is not None:
                identified_name = await self._identifier.wait_for_identification(
                    self.participant_identity
                )
            else:
                identified_name = None
            identified_name = identified_name or "Unknown"
            await self._on_identified_transcription({
                "user": identified_name,
                "text": user_transcript,
                "timestamp": time.time(),
                "spoken_at": time.time(),
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
        google_voice_credentials_json: Optional[str] = None,
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
        # Real-time speaker identifier (optional, created from voiceprints in room metadata)
        identifier: Optional[Any] = None,
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
            google_voice_credentials_json: Google service account credentials JSON (for validation/logging only, actual credentials loaded from GOOGLE_APPLICATION_CREDENTIALS env var)
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
        self._google_voice_credentials_json = google_voice_credentials_json
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
        self._pending_sessions: Set[str] = set()  # Participants with session creation in progress
        self._identifier: Optional[Any] = identifier  # RealtimeIdentifier for speaker ID

        # === Multi-core VAD optimization ===
        # Silero VAD hardcodes ONNX to intra_op_num_threads=1, inter_op_num_threads=1.
        # When multiple VADStreams share the same ONNX session, inference calls
        # serialize internally (one core busy, others idle).
        #
        # Fix: Create N separate VAD instances (each with its own ONNX session)
        # so inference can run truly in parallel across CPU cores.
        # Each speaker gets assigned a VAD instance via round-robin.
        cpu_count = os.cpu_count() or 4
        self._num_vad_instances = max(2, min(cpu_count, 6))  # 2-6 VAD instances
        self._vad_instances: List[silero.VAD] = []
        self._vad_round_robin = 0  # Counter for round-robin VAD assignment
        
        # Enlarge default thread pool so ONNX run_in_executor calls
        # can actually use all cores in parallel
        executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=self._num_vad_instances + 4,  # VAD threads + headroom
            thread_name_prefix="vad-onnx"
        )
        asyncio.get_event_loop().set_default_executor(executor)
        
        # Shared resilient STT with retry logic
        self._shared_stt: Optional[ResilientSTT] = None
        
        # Shared turn detector (loaded once, reused across all participants)
        self._turn_detector = None
        self._turn_detector_loaded = False
        
        # Pre-warmed session pool: ready AgentSessions waiting for assignment
        # Sessions are created with VAD+STT already initialized so there's
        # zero delay when track_subscribed fires (no lost audio frames)
        self._session_pool: asyncio.Queue[AgentSession] = asyncio.Queue()
        self._pool_size = 5  # Keep 5 sessions pre-warmed at all times
        self._pool_replenish_task: Optional[asyncio.Task] = None
        
        logger.info(
            f"multi_user_transcriber_initialized | "
            f"vad_threshold={vad_activation_threshold}, min_speech={vad_min_speech_duration}s, "
            f"min_silence={vad_min_silence_duration}s, prefix_padding={vad_prefix_padding_duration}s, "
            f"session_pool_size={self._pool_size}, "
            f"vad_instances={self._num_vad_instances}, cpu_cores={cpu_count}"
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

        # Define domain-specific hot words to bias the STT engine
        hot_words = [
            "Xyne Calls", "Juspay Euler", "Namma Cloud", "Xyne Chats",
            "Xyne Tickets", "Juspay Hyperswitch", "Xyne Support",
            "Namma Yatri", "Xyne Spaces", "Juspay", "Xyne Code",
            "Xyne Training", "Namma Bengaluru", "Xyne Automatic",
            "Juspay Payments Operating System", "Xyne AI",
            "Xyne Assistant", "Namma Shuttle", "Xyne Agent",
            "Xyne Bot", "Juspay Technologies", "Namma Switch",
        ]

        # Create Google STT with Chirp configuration and speech adaptation
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
            keywords=[(word, 10.0) for word in hot_words],
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
                # Domain-specific hot words shared with Google STT adaptation
                hot_words = [
                    "Xyne Calls", "Juspay Euler", "Namma Cloud", "Xyne Chats",
                    "Xyne Tickets", "Juspay Hyperswitch", "Xyne Support",
                    "Namma Yatri", "Xyne Spaces", "Juspay", "Xyne Code",
                    "Xyne Training", "Namma Bengaluru", "Xyne Automatic",
                    "Juspay Payments Operating System", "Xyne AI",
                    "Xyne Assistant", "Namma Shuttle", "Xyne Agent",
                    "Xyne Bot", "Juspay Technologies", "Namma Switch",
                ]
                # Nova-3 uses keyterms (plain strings); older models use keywords (word, boost) tuples.
                # detect_language=True is incompatible with streaming mode and with keyterms —
                # always use a fixed language when streaming.
                is_nova3 = self._deepgram_model.startswith("nova-3")
                inner_stt = deepgram.STT(
                    model=self._deepgram_model,
                    language=self._deepgram_language,
                    detect_language=False,
                    interim_results=True,
                    punctuate=True,
                    filler_words=True,
                    sample_rate=16000,
                    endpointing_ms=25,
                    api_key=self._deepgram_api_key,
                    keyterms=hot_words if is_nova3 else NOT_GIVEN,
                    keywords=[(w, 10.0) for w in hot_words] if not is_nova3 else NOT_GIVEN,
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
                stt_prompt = "Technical terms: Xyne Calls, Juspay Euler, Namma Cloud, Xyne Chats, Xyne Tickets, Juspay Hyperswitch, Xyne Support, Namma Yatri, Xyne Spaces, Juspay, Xyne Code, Xyne Training, Namma Bengaluru, Xyne Automatic, Juspay Payments Operating System, Xyne AI, Xyne Assistant, Namma Shuttle, Xyne Agent, Xyne Bot, Juspay Technologies, Namma Switch."
                inner_stt = openai.STT.with_azure(
                    azure_endpoint=self._azure_endpoint,
                    azure_deployment=self._azure_deployment,
                    api_version=self._azure_api_version,
                    api_key=self._azure_api_key,
                    #prompt=stt_prompt
                )
                self._shared_stt = ResilientSTT(inner_stt=inner_stt, max_retries=3, base_delay=1.0)
        return self._shared_stt
    
    def _init_vad_pool(self):
        """Initialize pool of VAD instances for multi-core parallelism.
        
        Each VAD instance has its own ONNX InferenceSession, so when multiple
        VADStreams call run_in_executor, they hit DIFFERENT ONNX sessions and
        can truly run in parallel across CPU cores.
        
        Without this, all streams share one ONNX session (hardcoded to 1 thread),
        causing inference to serialize on a single core.
        """
        if self._vad_instances:
            return  # Already initialized
        
        for i in range(self._num_vad_instances):
            vad = silero.VAD.load(
                activation_threshold=self._vad_activation_threshold,
                min_speech_duration=self._vad_min_speech_duration,
                min_silence_duration=self._vad_min_silence_duration,
                prefix_padding_duration=self._vad_prefix_padding_duration,
            )
            self._vad_instances.append(vad)
        
        logger.info(
            f"vad_pool_initialized | instances={self._num_vad_instances}, "
            f"activation_threshold={self._vad_activation_threshold}, "
            f"min_speech={self._vad_min_speech_duration}, "
            f"min_silence={self._vad_min_silence_duration}"
        )
    
    def _get_next_vad(self) -> silero.VAD:
        """Get next VAD instance via round-robin for even distribution across cores."""
        self._init_vad_pool()
        vad = self._vad_instances[self._vad_round_robin % self._num_vad_instances]
        self._vad_round_robin += 1
        return vad
    
    def _create_turn_detector(self):
        """Create or reuse shared turn detector singleton."""
        if not self._turn_detector_loaded:
            self._turn_detector = _load_turn_detector_model()
            self._turn_detector_loaded = True
            if self._turn_detector:
                logger.info("turn_detector_loaded | shared_across_all_participants=True")
            else:
                logger.warning("turn_detector_unavailable | fallback=vad_only")
        return self._turn_detector
    
    def _create_pooled_session(self) -> AgentSession:
        """Create a pre-configured AgentSession (not yet started).
        
        Uses round-robin VAD assignment so sessions are distributed across
        different ONNX sessions for multi-core parallelism.
        """
        return AgentSession(
            vad=self._get_next_vad(),
            stt=self._create_stt(call_type=self._call_type),
        )
    
    async def _warm_pool(self):
        """Pre-warm the session pool at startup. Called once from start()."""
        # Pre-load shared models first so pool creation is fast
        self._init_vad_pool()
        self._create_stt(call_type=self._call_type)
        self._create_turn_detector()
        
        for i in range(self._pool_size):
            try:
                session = self._create_pooled_session()
                await self._session_pool.put(session)
            except Exception as e:
                logger.error(f"pool_warm_failed | index={i}, error={e}")
        
        logger.info(f"session_pool_warmed | pool_size={self._session_pool.qsize()}")
    
    async def _replenish_pool(self):
        """Background task that keeps the session pool topped up."""
        while True:
            try:
                current_size = self._session_pool.qsize()
                if current_size < self._pool_size:
                    needed = self._pool_size - current_size
                    for _ in range(needed):
                        session = self._create_pooled_session()
                        await self._session_pool.put(session)
                    logger.debug(f"pool_replenished | added={needed}, pool_size={self._session_pool.qsize()}")
                await asyncio.sleep(1)  # Check every second
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"pool_replenish_error | error={e}")
                await asyncio.sleep(2)
    
    async def _get_session_from_pool(self) -> AgentSession:
        """Get a pre-warmed session from pool (instant, no delay)."""
        try:
            return self._session_pool.get_nowait()
        except asyncio.QueueEmpty:
            # Pool exhausted (shouldn't happen normally), create one on-demand
            logger.warning("session_pool_exhausted | creating_on_demand")
            return self._create_pooled_session()

    async def _emit_transcription(self, data: dict):
        """Emit transcription event via EventBus."""
        await self.bus.emit("TRANSCRIPTION", data)

    async def _emit_identified_transcription(self, data: dict):
        """Emit identified transcription event via EventBus."""
        await self.bus.emit("IDENTIFIED_TRANSCRIPTION", data)
    
    async def start(self):
        """Start room-level monitoring with track_subscribed for lazy session creation.
        
        Architecture:
        - Pre-warms a pool of AgentSessions at startup (no delay when audio arrives)
        - Uses track_subscribed instead of participant_connected to only create
          sessions for participants that actually publish audio tracks
        - Listeners (no mic) never get a session → no VAD inference overhead
        - Pool auto-replenishes in background to stay ready
        """
        try:
            # Pre-warm session pool FIRST so sessions are ready before any track arrives
            await self._warm_pool()
            
            # Start background pool replenishment
            self._pool_replenish_task = asyncio.create_task(self._replenish_pool())
            self._tasks.add(self._pool_replenish_task)
            self._pool_replenish_task.add_done_callback(lambda t: self._tasks.discard(t))
            
            # Use track_subscribed: only fires when an actual audio track arrives
            # This means participants without mics (listeners) never get a session
            self.ctx.room.on("track_subscribed", self._on_track_subscribed)
            self.ctx.room.on("track_unsubscribed", self._on_track_unsubscribed)
            self.ctx.room.on("participant_disconnected", self._on_participant_disconnected)
            
            # Register track mute/unmute handlers for session lifecycle
            # Sessions are created on unmute, destroyed on mute
            self.ctx.room.on("track_muted", self._on_track_muted)
            self.ctx.room.on("track_unmuted", self._on_track_unmuted)
            
            logger.info(f"transcriber_started | mode=mute_lifecycle, pool_size={self._session_pool.qsize()}")
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
        self._pending_sessions.clear()
        
        # Cancel pool replenishment task
        if self._pool_replenish_task and not self._pool_replenish_task.done():
            self._pool_replenish_task.cancel()
            try:
                await self._pool_replenish_task
            except asyncio.CancelledError:
                pass
        
        # Drain and close pooled sessions
        while not self._session_pool.empty():
            try:
                session = self._session_pool.get_nowait()
                await session.aclose()
            except Exception:
                pass
        
        # Unregister event handlers from ctx.room
        try:
            self.ctx.room.off("track_subscribed", self._on_track_subscribed)
            self.ctx.room.off("track_unsubscribed", self._on_track_unsubscribed)
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
    
    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ):
        """Handle audio track subscription.
        
        Session lifecycle is tied to mute state:
        - If participant joins unmuted → create session immediately
        - If participant joins muted → skip, session will be created on unmute
        
        This avoids creating sessions for muted participants (no VAD overhead).
        """
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        
        participant_name = participant.name or participant.identity
        logger.info(
            f"track_subscribed | participant_id={participant.identity}, "
            f"participant_name={participant_name}, track_sid={track.sid}, "
            f"publication_muted={publication.muted}, pool_available={self._session_pool.qsize()}"
        )
        
        if publication.muted:
            logger.info(
                f"track_subscribed_muted_no_session | participant_id={participant.identity}, "
                f"participant_name={participant_name}"
            )
        else:
            self._create_participant_session(participant)
            if self._identifier is not None:
                task = asyncio.create_task(
                    self._identifier.process_track(track, participant.identity)
                )
                self._tasks.add(task)
                task.add_done_callback(lambda t: self._tasks.discard(t))
    
    def _on_track_unsubscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ):
        """Handle audio track unsubscription - final cleanup when track goes away.
        
        Session may already be destroyed (by mute), but this ensures cleanup
        if participant's track is removed while unmuted.
        """
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        
        # Check if participant has any other audio tracks remaining
        has_other_audio = any(
            pub.kind == rtc.TrackKind.KIND_AUDIO and pub.sid != publication.sid
            for pub in participant.track_publications.values()
        )
        if has_other_audio:
            return
        
        participant_name = participant.name or participant.identity
        logger.info(f"track_unsubscribed | participant_id={participant.identity}, participant_name={participant_name}")
        self._destroy_participant_session(participant)
        if self._identifier is not None:
            self._identifier.cancel_participant(participant.identity)
    
    def _on_participant_disconnected(self, participant: rtc.RemoteParticipant):
        """Handle participant disconnection - final cleanup."""
        participant_name = participant.name or participant.identity
        logger.info(f"participant_disconnected | participant_id={participant.identity}, participant_name={participant_name}")
        self._destroy_participant_session(participant)
        if self._identifier is not None:
            self._identifier.cancel_participant(participant.identity)
    
    def _on_track_muted(self, participant, publication):
        """Handle track muted - destroy the participant's session.
        
        Session lifecycle: unmuted = session exists, muted = no session.
        This ensures only unmuted participants consume VAD/CPU resources.
        NOTE: SDK emits ("track_muted", participant, publication) — participant FIRST.
        """
        try:
            if publication.kind != rtc.TrackKind.KIND_AUDIO or publication.source != rtc.TrackSource.SOURCE_MICROPHONE:
                return
            
            participant_name = participant.name or participant.identity
            logger.info(
                f"track_muted_destroying_session | participant_id={participant.identity}, "
                f"participant_name={participant_name}, publication_sid={publication.sid}"
            )
            self._destroy_participant_session(participant)
        except Exception as e:
            logger.error(f"track_muted_error | error={e}", exc_info=True)
    
    def _on_track_unmuted(self, participant, publication):
        """Handle track unmuted - create a new session for the participant.
        
        Session lifecycle: unmuted = session exists, muted = no session.
        Uses pre-warmed pool for instant session creation (no lost audio frames).
        NOTE: SDK emits ("track_unmuted", participant, publication) — participant FIRST.
        """
        try:
            if publication.kind != rtc.TrackKind.KIND_AUDIO or publication.source != rtc.TrackSource.SOURCE_MICROPHONE:
                return
            
            participant_name = participant.name or participant.identity
            logger.info(
                f"track_unmuted_creating_session | participant_id={participant.identity}, "
                f"participant_name={participant_name}, publication_sid={publication.sid}, "
                f"pool_available={self._session_pool.qsize()}"
            )
            self._create_participant_session(participant)
        except Exception as e:
            logger.error(f"track_unmuted_error | error={e}", exc_info=True)
    
    async def _start_session(self, participant: rtc.RemoteParticipant) -> AgentSession:
        """
        Start an AgentSession for a participant using a pre-warmed session from the pool.
        
        The pool ensures zero delay — the session (with VAD+STT already configured)
        is grabbed instantly, so no audio frames are lost.
        
        Args:
            participant: The remote participant to transcribe
        Returns:
            The started AgentSession
        """
        participant_name = participant.name or participant.identity
        
        # Grab pre-warmed session from pool (instant, no initialization delay)
        session = await self._get_session_from_pool()
        
        # Create agent for this participant with shared turn detector
        agent = ParticipantTranscriber(
            participant_identity=participant.identity,
            participant_name=participant_name,
            on_transcription=self._emit_transcription,
            call_id=self._call_id,
            ai_enabled=self._is_ai_enabled(),
            turn_detector=self._create_turn_detector(),
            on_identified_transcription=self._emit_identified_transcription if self._identifier is not None else None,
            identifier=self._identifier,
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
    
    async def _close_session(self, session: AgentSession, participant_identity: str = None):
        """
        Close an AgentSession gracefully.

        Args:
            session: The session to close
            participant_identity: The participant's identity (for cleanup)
        """
        try:
            # Force VAD flush: inject silence to trigger END_OF_SPEECH for any buffered speech
            if hasattr(session, '_activity') and session._activity:
                activity = session._activity
                if hasattr(activity, '_audio_recognition') and activity._audio_recognition:
                    audio_rec = activity._audio_recognition
                    try:
                        audio_rec.commit_user_turn(
                            transcript_timeout=2.0,
                            stt_flush_duration=0.6,
                            audio_detached=False
                        )
                        # Wait for the async flush task to complete
                        if hasattr(audio_rec, '_commit_user_turn_atask') and audio_rec._commit_user_turn_atask:
                            try:
                                await asyncio.wait_for(audio_rec._commit_user_turn_atask, timeout=3.0)
                            except asyncio.TimeoutError:
                                logger.warning(f"stt_flush_task_timeout | participant_id={participant_identity}")
                        
                        # Emit transcript if flush captured speech (normal callback won't fire since session is closing)
                        transcript = getattr(audio_rec, '_audio_transcript', None)
                        if transcript and transcript.strip():
                            agent = getattr(activity, '_agent', None)
                            participant_name = getattr(agent, 'participant_name', participant_identity) if agent else participant_identity
                            await self._emit_transcription({
                                "user": participant_name,
                                "text": transcript,
                                "timestamp": time.time(),
                                "spoken_at": time.time(),
                                "participant_identity": participant_identity,
                            })
                    except Exception as e:
                        logger.warning(f"stt_flush_failed | participant_id={participant_identity}, error={e}")
            
            logger.info(f"stt_drain_started")
            await session.drain()
            logger.info(f"stt_drain_completed")
            await session.aclose()
        except asyncio.TimeoutError:
            logger.warning(f"stt_drain_timeout")
        except Exception as e:
            logger.warning(f"participant_session_close_error | error={e}")
    
    def handle_existing_participants(self):
        """Start sessions for participants already in the room with unmuted audio tracks.
        
        Delegates to _on_track_subscribed which checks mute state:
        - Unmuted participants → session created immediately
        - Muted participants → session created when they unmute
        """
        for participant in self.ctx.room.remote_participants.values():
            for _, publication in participant.track_publications.items():
                if (
                    publication.kind == rtc.TrackKind.KIND_AUDIO
                    and publication.track is not None
                ):
                    self._on_track_subscribed(
                        publication.track, publication, participant
                    )
                    break  # One audio track per participant is enough
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
    
    def _create_participant_session(self, participant: rtc.RemoteParticipant):
        """Create a new AgentSession for a participant from the pre-warmed pool.
        
        Handles deduplication and race conditions:
        - Skips if session already exists or creation is in progress
        - After creation, re-checks mute state in case participant muted during async creation
        """
        if participant.identity in self._sessions or participant.identity in self._pending_sessions:
            logger.debug(f"session_already_exists_or_pending | participant_id={participant.identity}")
            return
        
        participant_name = participant.name or participant.identity
        self._pending_sessions.add(participant.identity)
        
        logger.info(
            f"session_creating | participant_id={participant.identity}, "
            f"participant_name={participant_name}, pool_available={self._session_pool.qsize()}"
        )
        
        task = asyncio.create_task(self._start_session(participant))
        self._tasks.add(task)
        
        def on_task_done(t: asyncio.Task):
            self._pending_sessions.discard(participant.identity)
            try:
                session = t.result()
                self._sessions[participant.identity] = session
                
                # Re-check: participant may have muted during async session creation
                is_still_unmuted = False
                for _, pub in participant.track_publications.items():
                    if pub.kind == rtc.TrackKind.KIND_AUDIO and pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
                        is_still_unmuted = not pub.muted
                        break
                
                if is_still_unmuted:
                    logger.info(
                        f"participant_session_started | participant_id={participant.identity}, "
                        f"participant_name={participant_name}"
                    )
                else:
                    # Muted during creation — destroy immediately
                    logger.info(
                        f"session_created_but_now_muted | participant_id={participant.identity}, "
                        f"participant_name={participant_name}, closing_immediately=True"
                    )
                    self._destroy_participant_session(participant)
            except Exception as e:
                logger.error(f"participant_session_failed | participant_id={participant.identity}, error={e}")
            finally:
                self._tasks.discard(t)
        
        task.add_done_callback(on_task_done)
    
    def _destroy_participant_session(self, participant: rtc.RemoteParticipant):
        """Close and remove a participant's AgentSession.
        
        Safe to call even if no session exists (no-op).
        Also clears pending state if session creation was in progress.
        """
        self._pending_sessions.discard(participant.identity)
        
        session = self._sessions.pop(participant.identity, None)
        if session is None:
            return
        
        participant_name = participant.name or participant.identity
        logger.info(f"session_destroying | participant_id={participant.identity}, participant_name={participant_name}")
        
        task = asyncio.create_task(self._close_session(session, participant.identity))
        self._tasks.add(task)
        task.add_done_callback(lambda t: self._tasks.discard(t))

