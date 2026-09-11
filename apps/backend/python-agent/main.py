"""
LiveKit Passive Transcription Agent
Listens to room audio, transcribes via OpenAI Whisper, and publishes results
"""
import asyncio
import json
import os
import re
import ssl

import redis.asyncio as redis
from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli

from config import Config, setup_logging, get_logger, set_call_id
from transcription import (
    TranscriptionDeduplicator,
    TranscriptionStorage,
    LiveKitPublisher,
    TranscriptionHandler,
)
from infra import WebhookNotifier, GCSBucketProvider, S3BucketProvider
from history import ConversationStore
from ai import AISessionManager
from orchestration import CleanupManager, ParticipantTracker, RoomLifecycle
from domain import CallContext
from events import EventBus
from modules import MultiUserTranscriber
from tools import create_ticket_creation_tool, create_get_my_tickets_tool, create_invite_user_tool
from health_server import start_health_server
import tempfile

# Configure logging
setup_logging()
logger = get_logger(__name__)

# Suppress livekit-agents internal logging - only show CRITICAL errors
# This must be done at module level (before cli.run_app) to catch all logs
import logging as _logging
_logging.getLogger("livekit").setLevel(_logging.CRITICAL)
_logging.getLogger("livekit.agents").setLevel(_logging.CRITICAL)
_logging.getLogger("livekit.plugins").setLevel(_logging.CRITICAL)
_logging.getLogger("livekit.agents.ipc").setLevel(_logging.CRITICAL)

# Load configuration
config = Config.load()

# Only log startup info in main process (not in worker processes)
import multiprocessing as _mp
if _mp.current_process().name == "MainProcess":
    logger.info(f"Connecting to LiveKit at: {config.livekit_url}")
    logger.info(f"Azure OpenAI STT Endpoint: {config.azure_stt_endpoint}")
    logger.info(f"Azure OpenAI STT Model: {config.azure_stt_model}")
    logger.info(f"STT Provider: {config.stt_provider}")
    logger.info(f"Diarization Enabled: {config.diarization_enabled}")
    logger.info(f"Environment: {config.node_env} (development mode: {config.is_development})")


def _cleanup_duplicate_handlers():
    """
    Remove all duplicate and JSON handlers from root logger.
    
    Livekit-agents adds its own handlers (text + JSON) after our setup_logging().
    This function removes ALL handlers and adds a single text handler with our format.
    Must be called from within entrypoint (after livekit has configured handlers).
    """
    root_logger = _logging.getLogger()
    
    # Remove ALL existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add a single handler with our format
    handler = _logging.StreamHandler()
    handler.setFormatter(_logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    root_logger.addHandler(handler)
    root_logger.setLevel(_logging.INFO)


async def entrypoint(ctx: JobContext):
    """
    Agent entrypoint - called when agent joins a room

    Args:
        ctx: JobContext provided by livekit-agents framework
    """
    # Clean up duplicate handlers added by livekit-agents
    # This must be done here (not at module level) because livekit adds handlers
    # after cli.run_app() starts worker processes
    _cleanup_duplicate_handlers()
    # Create secure Google credentials file from JSON environment variable
    # Google Cloud SDKs read credentials from GOOGLE_APPLICATION_CREDENTIALS file path
    if config.google_voice_credentials_json:
        try:
            # Validate JSON and log project info
            if isinstance(config.google_voice_credentials_json, str):
                parsed = json.loads(config.google_voice_credentials_json)
                logger.info(
                    f"[Google STT] Valid credentials JSON, project={parsed.get('project_id')}"
                )
            else:
                parsed = config.google_voice_credentials_json
                logger.info(
                    f"[Google STT] Credentials dict format, project={parsed.get('project_id')}"
                )
            
            # Create secure temporary file for credentials
            # delete=False keeps file after close, we'll clean it up on agent shutdown
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(parsed, f, indent=2, ensure_ascii=False)
                credentials_file = f.name
            
            # Set file permissions to 600 (owner read/write only) for security
            os.chmod(credentials_file, 0o600)
            
            # Set environment variable to file path for Google SDK auto-discovery
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_file
            logger.info(f"[Google STT] Credentials file created at {credentials_file}")
            
        except json.JSONDecodeError as e:
            logger.error(
                f"[Google STT] JSON parsing failed at position {e.pos}"
            )
        except Exception as e:
            logger.error(f"[Google STT] Failed to setup credentials: {e}")
    else:
        logger.warning("[Google STT] Credentials not provided")
    
    # Get the room name (call_id) for file storage
    call_id = ctx.room.name

    set_call_id(call_id)

    # Sanitize call_id to prevent path traversal attacks
    # Allow only alphanumeric characters, underscores, and hyphens
    safe_call_id = re.sub(r'[^a-zA-Z0-9_-]', '_', call_id)

    if safe_call_id != call_id:
        logger.warning(f"room_name_sanitized | original={call_id}, sanitized={safe_call_id}")

    logger.info(f"agent_starting | node_env={config.node_env}, diarization_enabled={config.diarization_enabled}")

    # Initialize conversation store (Redis-backed, without OpenAI client yet)
    conversation_store = None
    try:
        # Build Redis connection kwargs (matching TypeScript ioredis config)
        redis_kwargs = {
            "host": config.redis_host,
            "port": config.redis_port,
            "decode_responses": True,
        }
        if config.redis_password:
            redis_kwargs["password"] = config.redis_password
        if config.redis_tls:
            # Match TypeScript: tls: { rejectUnauthorized: false }
            redis_kwargs["ssl"] = True
            redis_kwargs["ssl_cert_reqs"] = ssl.CERT_NONE
        
        logger.info(f"redis_connection_attempt | host=REDACTED, port=REDACTED, tls=REDACTED")
        redis_client = redis.Redis(**redis_kwargs)
        ping_result = await redis_client.ping()  # type: ignore[misc]
        conversation_store = ConversationStore(
            redis_client=redis_client,
            call_id=call_id,
            ttl=config.conversation_ttl,
            max_history=config.max_conversation_history,
            openai_client=None,  # Will be set after AI manager initializes
            model=config.azure_openai_model,  # Use same model as agent
        )
        logger.info(f"redis_connected | host=REDACTED, port=REDACTED, ttl=REDACTED")
    except Exception as e:
        logger.warning(f"redis_connection_failed | error={e}, fallback=in_memory")
        conversation_store = None

    # Initialize modules
    event_bus = EventBus()
    
    # Initialize MultiUserTranscriber with configured STT provider
    # Supports Azure OpenAI Whisper, Google Cloud STT, Deepgram STT, and Chutes.ai Whisper
    multi_user_transcriber = MultiUserTranscriber(
        ctx=ctx,
        event_bus=event_bus,
        stt_provider=config.stt_provider,
        azure_endpoint=config.azure_stt_endpoint,
        azure_api_key=config.azure_stt_api_key,
        azure_api_version=config.azure_stt_api_version,
        azure_deployment=config.azure_stt_model,  # Model name is deployment name for Azure
        stt_model=config.stt_model,
        google_voice_credentials_json=config.google_voice_credentials_json,
        google_stt_model=config.google_stt_model,
        google_stt_language=config.google_stt_language,
        deepgram_api_key=config.deepgram_api_key,
        deepgram_model=config.deepgram_model,
        deepgram_language=config.deepgram_language,
        chutes_stt_base_url=config.chutes_stt_base_url,
        chutes_stt_api_key=config.chutes_stt_api_key,
        vad_activation_threshold=config.vad_activation_threshold,
        vad_min_speech_duration=config.vad_min_speech_duration,
        vad_min_silence_duration=config.vad_min_silence_duration,
        vad_prefix_padding_duration=0.5,  # Pre-buffer 500ms to capture speech onset
        call_id=call_id,
        # identifier wired in below after room metadata is parsed
    )

    # Initialize storage bucket provider based on STORAGE_PROVIDER config
    bucket = None
    if config.storage_provider == 's3':
        s3_provider = S3BucketProvider(
            bucket_name=config.s3_bucket_name,
            region=config.s3_region,
            access_key_id=config.s3_access_key_id,
            secret_access_key=config.s3_secret_access_key,
            endpoint_url=config.s3_endpoint or None,
        )
        bucket = s3_provider.get_bucket()
        if bucket:
            logger.info(f"s3_bucket_initialized | bucket={config.s3_bucket_name}, region={config.s3_region}")
        else:
            logger.warning(f"s3_bucket_not_available | bucket={config.s3_bucket_name}, fallback=local")
    else:
        gcs_provider = GCSBucketProvider(
            project_id=config.gcs_project_id,
            bucket_name=config.gcs_bucket_name,
            credentials_path=config.gcs_credentials_path,
        )
        bucket = gcs_provider.get_bucket()
        if bucket:
            logger.info(f"gcs_bucket_initialized | bucket={config.gcs_bucket_name}, project={config.gcs_project_id}")
        else:
            logger.warning(f"gcs_bucket_not_available | project={config.gcs_project_id}, bucket={config.gcs_bucket_name}, fallback=local")

    # Initialize transcription storage (GCS with buffer, or local fallback)
    use_buffer = bucket is not None  # Always buffer when GCS is available
    transcription_storage = TranscriptionStorage(
        call_id=call_id,
        safe_call_id=safe_call_id,
        bucket=bucket,
        use_buffer=use_buffer,
        flush_every_n=config.transcript_flush_every_n,
        base_load_max_retries=config.transcript_base_load_max_retries,
        base_load_backoff_cap_s=config.transcript_base_load_backoff_cap_s,
    )

    identified_storage = None
    if config.diarization_enabled:
        # Initialize identified transcript storage (parallel to primary, written with real names)
        identified_storage = TranscriptionStorage(
            call_id=f"{call_id}_identified",
            safe_call_id=f"{safe_call_id}_identified",
            bucket=bucket,
            use_buffer=use_buffer,
            flush_every_n=config.transcript_flush_every_n,
            base_load_max_retries=config.transcript_base_load_max_retries,
            base_load_backoff_cap_s=config.transcript_base_load_backoff_cap_s,
        )
        logger.info("identified_transcript_storage_initialized | diarization_enabled=true")
    else:
        logger.info("identified_transcript_storage_skipped | DIARIZATION_ENABLED=false")

    # Initialize AI Session Manager
    ai_manager = AISessionManager(
        config=config,
        conversation_store=conversation_store,
        ai_voice_enabled_default=config.ai_voice_enabled_default,
    )
    
    # Initialize Azure services (TTS/LLM)
    logger.info(f"azure_services_initializing | stt={config.azure_stt_endpoint}, tts={config.azure_tts_endpoint}, llm={config.azure_openai_endpoint}")
    azure_initialized = await ai_manager.initialize_azure_services()
    if not azure_initialized:
        logger.warning(f"azure_services_failed | error=initialization_failed, fallback=ai_disabled")
    
    # Set OpenAI client in conversation store for LLM-based compaction
    if conversation_store and ai_manager.llm:
        from openai import AsyncAzureOpenAI
        # Create AsyncAzureOpenAI client reusing the same config as ai_manager
        conversation_store.openai_client = AsyncAzureOpenAI(
            api_key=config.azure_openai_api_key,
            azure_endpoint=config.azure_openai_endpoint,
            api_version="2024-10-21",
        )
        logger.info(f"conversation_store_configured | max_history={config.max_conversation_history}, compaction=llm")

    # Initialize transcription pipeline components
    deduplicator = TranscriptionDeduplicator()
    publisher = LiveKitPublisher(ctx.room)
    
    # Create transcription handler (coordinates all transcription processing)
    transcription_handler = TranscriptionHandler(
        publisher=publisher,
        storage=transcription_storage,
        deduplicator=deduplicator,
        conversation_store=conversation_store,
        ai_manager=ai_manager,
        call_id=call_id,
    )
    
    # Subscribe to transcription events
    event_bus.subscribe("TRANSCRIPTION", transcription_handler.handle)
    logger.info(f"event_bus_subscribed | event=TRANSCRIPTION, handler=transcription_handler")

    if identified_storage is not None:
        storage_for_identified_transcripts = identified_storage
        # Subscribe to identified transcription events → second storage (real names)
        async def handle_identified_transcription(data: dict):
            await storage_for_identified_transcripts.write(data)

        event_bus.subscribe("IDENTIFIED_TRANSCRIPTION", handle_identified_transcription)
        logger.info(f"event_bus_subscribed | event=IDENTIFIED_TRANSCRIPTION, handler=identified_storage")
    else:
        logger.info("event_bus_subscription_skipped | event=IDENTIFIED_TRANSCRIPTION, reason=diarization_disabled")

    # Subscribe to AI action events (for frontend popup triggers like invite user)
    async def handle_ai_action(data: dict):
        """Publish AI action events to frontend via LiveKit data channel"""
        # Get current controller to target HITL actions
        controller_info = ai_manager.get_controller_info()
        controller_id = controller_info.get("controller_id")
        await publisher.publish_action(data, controller_id=controller_id)

    event_bus.subscribe("AI_ACTION", handle_ai_action)
    logger.info(f"event_bus_subscribed | event=AI_ACTION, handler=handle_ai_action")

    # Handle AI voice toggle and control requests from frontend
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):  # pyright: ignore[reportUnusedFunction]
        """Handle data messages from frontend for AI voice toggle and control requests"""
        try:
            payload = json.loads(data_packet.data.decode("utf-8"))
            
            # Get participant info from data packet
            participant = data_packet.participant
            participant_id = participant.identity if participant else None
            participant_name = participant.name if participant else None
            
            # Check if it's an AI voice toggle message
            if payload.get("type") == "ai_voice_toggle":
                new_state = payload.get("enabled", False)
                ai_manager.handle_voice_toggle(new_state, participant_id, participant_name)

            elif payload.get("type") == "transcription_toggle":
                # Host kill-switch. SECURITY: only the call host (createdBy in room
                # metadata) may toggle, verified against the authenticated sender
                # identity — never the payload. FAIL CLOSED: if the host id is
                # unavailable (older room metadata) or the sender is not the host,
                # reject rather than trusting client-side gating.
                #
                # The AGENT is authoritative: it always broadcasts `transcription_state`
                # with its ACTUAL state so clients never show "off" unless the agent
                # really stopped. On apply we confirm only AFTER the teardown completes;
                # on reject we confirm the (unchanged) current state so the UI reverts.
                def _publish_transcription_state(enabled_now: bool):
                    try:
                        state = json.dumps(
                            {"type": "transcription_state", "enabled": enabled_now}
                        ).encode("utf-8")
                        asyncio.create_task(
                            ctx.room.local_participant.publish_data(
                                state, reliable=True, topic="ai-actions"
                            )
                        )
                    except Exception as e:  # noqa: BLE001
                        logger.error(f"publish transcription_state failed: {e}")

                host_id = room_metadata.get("createdBy") if isinstance(room_metadata, dict) else None
                if not host_id:
                    logger.warning(
                        "transcription_toggle rejected: host id unavailable in room metadata (fail-closed)"
                    )
                    _publish_transcription_state(multi_user_transcriber.is_enabled())
                elif participant_id != host_id:
                    logger.warning(
                        f"transcription_toggle rejected: sender={participant_id} is not host={host_id}"
                    )
                    _publish_transcription_state(multi_user_transcriber.is_enabled())
                else:
                    requested = bool(payload.get("enabled", True))
                    logger.info(
                        f"transcription_toggle received | enabled={requested}, "
                        f"by={participant_name} ({participant_id})"
                    )

                    async def _apply_and_confirm(target: bool):
                        await multi_user_transcriber.set_transcription_enabled(target)
                        _publish_transcription_state(multi_user_transcriber.is_enabled())

                    asyncio.create_task(_apply_and_confirm(requested))

            elif payload.get("type") == "ai_control_request":
                # SECURITY: Use authenticated participant identity from data_packet, not from payload
                # This prevents identity spoofing attacks
                if participant_id and participant_name:
                    asyncio.create_task(ai_manager.request_control(participant_id, participant_name))
            
            elif payload.get("type") == "ai_control_transfer":
                logger.info(f"Received ai_control_transfer from {participant_name} ({participant_id})")
                logger.info(f"Payload: {payload}")
                
                # SECURITY: Validate that current controller is approving the transfer
                # Only the current controller can approve transfers
                controller_info = ai_manager.get_controller_info()
                current_controller_id = controller_info.get("controller_id")
                
                logger.info(f"Current controller: {current_controller_id}, Sender: {participant_id}")
                
                if current_controller_id and current_controller_id == participant_id:
                    new_controller_id = payload.get("new_controller_id")
                    new_controller_name = payload.get("new_controller_name")
                    logger.info(f"Transfer approved: new_controller_id={new_controller_id}, new_controller_name={new_controller_name}")
                    if new_controller_id and new_controller_name:
                        asyncio.create_task(ai_manager.transfer_control(new_controller_id, new_controller_name))
                    else:
                        logger.warning(f"Missing controller info in transfer: id={new_controller_id}, name={new_controller_name}")
                else:
                    logger.warning(f"Transfer rejected: current_controller={current_controller_id} != sender={participant_id}")
        except json.JSONDecodeError:
            pass  # Ignore non-JSON data messages
        except Exception as e:
            logger.error(f"Error handling data message: {e}")

    # Connect to room with auto-subscribe to audio only
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info(f"room_connected | auto_subscribe=AUDIO_ONLY")
    # Set the participant name to "Xyne Automatic"
    await ctx.room.local_participant.set_name("Xyne Automatic")

    # Create webhook notifier early — used both to fetch voiceprints now
    # and to notify transcript-ready later.
    webhook = WebhookNotifier(config.backend_url, config.transcription_agent_api_key)

    room_metadata = {}
    try:
        if ctx.room.metadata:
            room_metadata = json.loads(ctx.room.metadata)
            logger.info(f"room_context_loaded | channel_id={room_metadata.get('channelId')}, board_id={room_metadata.get('boardId')}, project_id={room_metadata.get('projectId')}, participants={len(ctx.room.remote_participants)}")
            
            # Extract call type for STT selection
            call_type = room_metadata.get("callType")
            if call_type:
                multi_user_transcriber.set_call_type(call_type)
                logger.info(f"[STT Selection] Call type: {call_type}")
            
            # Extract user's STT model preference
            stt_model_override = room_metadata.get("sttModel")
            if stt_model_override:
                multi_user_transcriber.set_stt_model_override(stt_model_override)
                if config.stt_provider != "chutes":
                    logger.info(f"[STT Selection] User selected: {stt_model_override}")

            if config.diarization_enabled:
                # Fetch voiceprints at runtime from backend (avoids 64 KB LiveKit metadata limit
                # and always reflects the latest enrollments for large orgs).
                logger.info("realtime_identification_setup_started | fetching_voiceprints=true")
                voiceprints = await webhook.fetch_voiceprints()
                if voiceprints:
                    from modules.realtime_identifier import RealtimeIdentifier
                    identifier = RealtimeIdentifier(voiceprints)
                    multi_user_transcriber._identifier = identifier
                    logger.info(
                        f"realtime_identification_enabled | voiceprints={len(voiceprints)}"
                    )
                else:
                    logger.info("realtime_identification_disabled | no voiceprints enrolled")
            else:
                logger.info("realtime_identification_skipped | DIARIZATION_ENABLED=false")
    except Exception as e:
        logger.warning(f"room_context_load_failed | error={e}")
    
    # Build participant name to ID mapping
    participant_map = {}
    for participant in ctx.room.remote_participants.values():
        participant_name = participant.name or participant.identity
        participant_map[participant_name] = participant.identity
    
    # Create call context (unified state for this call)
    call_context = CallContext(
        call_id=call_id,
        safe_call_id=safe_call_id,
        channel_id=room_metadata.get("channelId"),
        board_id=room_metadata.get("boardId"),
        project_id=room_metadata.get("projectId"),
        backend_url=config.backend_url,
        api_key=config.transcription_agent_api_key,
        participant_map=participant_map,
    )
    logger.info(f"call_context_created | channel_id={call_context.channel_id}, board_id={call_context.board_id}, participants={list(call_context.participant_map.keys())}")

    # Set room context and create AgentSession with tools
    ai_manager.room_context = call_context.to_room_context()
    
    # Validate call context for tool use
    if not call_context.is_valid_for_tools():
        if not call_context.channel_id:
            logger.warning(f"call_context_validation_warning | missing_field=channelId, impact=ticket_creation_may_fail")
        if not call_context.board_id:
            logger.warning(f"call_context_validation_warning | missing_field=boardId, impact=ticket_creation_may_fail")
        if not call_context.backend_url:
            logger.warning(f"call_context_validation_warning | missing_field=backend_url, impact=ticket_creation_will_fail")
        if not call_context.api_key:
            logger.warning(f"call_context_validation_warning | missing_field=api_key, impact=ticket_creation_will_fail")
    
    # Create ticket creation tool
    room_context = call_context.to_room_context()
    async def announce_tool(message: str):
        """Helper to make the agent speak any announcement"""
        if ai_manager.agent_session:
            logger.info(f"Announcing tool usage: {message}")
            try:
                # say() returns a SpeechHandle synchronously, no need to await/create_task
                ai_manager.agent_session.say(message)
            except Exception as e:
                logger.error(f"Failed to announce tool: {e}")   
    room_context["announce_tool"] = announce_tool
    
    create_ticket_tool = create_ticket_creation_tool(room_context, event_bus.emit)
    get_my_tickets_tool = create_get_my_tickets_tool(room_context)
    invite_user_tool = create_invite_user_tool(room_context, event_bus.emit)
    
    # Create AgentSession with tools
    await ai_manager.create_agent_session(tools=[create_ticket_tool, get_my_tickets_tool, invite_user_tool])

    # Start AgentSession and link to event bus for AI replies
    ai_manager.set_transcription_emitter(event_bus.emit)
    await ai_manager.start_agent_session(ctx.room)
    
    # Link AgentSession to MultiUserTranscriber for VAD-based speech interruption
    if ai_manager.is_ready():
        multi_user_transcriber.set_agent_session(ai_manager.get_agent_session())
        logger.info(f"agent_session_linked | component=multi_user_transcriber")
        multi_user_transcriber.set_ai_manager(ai_manager)
        logger.info("Linked AgentSession and AI Manager to MultiUserTranscriber for speech interruption and adaptive turn detection")

    # Initialize cleanup manager
    participant_tracker = ParticipantTracker()
    
    # Note: We'll pass stt_tasks after RoomLifecycle creates them
    cleanup_manager = CleanupManager(
        call_id=call_id,
        stt_tasks={},  # Will be updated by room_lifecycle
        storage=transcription_storage,
        webhook=webhook,
        room=ctx.room,
        conversation_store=conversation_store,
        additional_storages=[identified_storage] if identified_storage is not None else [],
    )
    
    # Initialize room lifecycle manager
    room_lifecycle = RoomLifecycle(
        ctx=ctx,
        tracker=participant_tracker,
        cleanup_manager=cleanup_manager,
        call_context=call_context,
        multi_user_transcriber=multi_user_transcriber,  # Use new built-in STT
        ai_manager=ai_manager,
    )
    
    # Update cleanup manager with stt_tasks reference (empty for MultiUserTranscriber)
    cleanup_manager.stt_tasks = room_lifecycle.get_stt_tasks()
    
    # Register all room event handlers
    room_lifecycle.register_handlers()
    
    # Initialize tracker with existing participants
    participant_tracker.initialize_from_room(ctx.room)
    logger.info(f"agent_ready | participants={len(participant_tracker.active_participants)}")
    
    # Register mute event handlers AFTER agent is fully ready
    # This ensures agent is set up before we start receiving track events
    await multi_user_transcriber.start()
    
    # Handle any participants already in room
    multi_user_transcriber.handle_existing_participants()
    logger.info(f"event_handlers_registered | timing=after_agent_ready")

    # Simple wait - let the agent run until LiveKit disconnects it.
    # Durability of the transcript does NOT depend on this exit path: the buffer is
    # streamed to GCS incrementally every N events (see TranscriptionStorage), and the
    # final flush + backend notify run via the empty-room CleanupManager path as the
    # call ends. So a forced/ungraceful exit here loses at most the last N events.
    try:
        await asyncio.Future()  # Wait forever until cancelled
    except asyncio.CancelledError:
        logger.info("Agent cancelled, exiting gracefully")
        raise
    finally:
        # Shield so an in-flight cancellation cannot abort the flush midway.
        # run() is idempotent, so if the shutdown callback already cleaned up this
        # returns immediately.
        try:
            await asyncio.shield(cleanup_manager.run(reason="entrypoint_finally"))
        except asyncio.CancelledError:
            logger.warning("cleanup_interrupted_during_finally | transcript_may_be_incomplete")
            raise
        except Exception:
            logger.error("cleanup_failed_in_finally", exc_info=True)


def start_health_server_background():
    """Start health server in background thread"""
    import threading
    import os

    def run_health_server():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        health_port = int(os.environ.get("HEALTH_PORT", "8080"))
        loop.run_until_complete(start_health_server(host="0.0.0.0", port=health_port))
        loop.run_forever()

    health_thread = threading.Thread(target=run_health_server, daemon=True)
    health_thread.start()
    logger.info("Health server started in background thread")


if __name__ == "__main__":
    # Start health server in background
    start_health_server_background()

    # Run the LiveKit agent (blocks until shutdown)
    # agent_name switches this worker from automatic dispatch (joins every room) to
    # explicit dispatch — the backend must now request it by name via
    # AgentDispatchClient.createDispatch. This is what makes zero-downtime, canary-tested
    # agent rollouts possible: a new pod runs under a new agent_name and is invisible to
    # real traffic until the backend (via this pod's own self-report, or a human fallback)
    # rolls it into the 'stable' or 'test' slot.
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name=config.transcription_agent_name,
        shutdown_process_timeout=60.0,
        job_memory_warn_mb=4096,
    ))
