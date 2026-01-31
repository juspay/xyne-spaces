"""
LiveKit Passive Transcription Agent
Listens to room audio, transcribes via OpenAI Whisper, and publishes results
"""
import asyncio
import json
import re
import ssl

import redis.asyncio as redis
from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli

from config import Config, setup_logging, get_logger
from transcription import (
    TranscriptionDeduplicator,
    TranscriptionStorage,
    LiveKitPublisher,
    TranscriptionHandler,
)
from infra import WebhookNotifier, GCSBucketProvider
from history import ConversationStore
from ai import AISessionManager
from orchestration import CleanupManager, ParticipantTracker, RoomLifecycle
from domain import CallContext
from events import EventBus
from modules import MultiUserTranscriber
from tools import create_ticket_creation_tool, create_get_my_tickets_tool, create_invite_user_tool
from health_server import start_health_server

# Configure logging
setup_logging()
logger = get_logger(__name__)

# Load configuration
config = Config.load()

logger.info(f"Connecting to LiveKit at: {config.livekit_url}")
logger.info(f"Azure OpenAI STT Endpoint: {config.azure_stt_endpoint}")
logger.info(f"Azure OpenAI STT Model: {config.azure_stt_model}")
logger.info(f"Environment: {config.node_env} (development mode: {config.is_development})")


async def entrypoint(ctx: JobContext):
    """
    Agent entrypoint - called when agent joins a room

    Args:
        ctx: JobContext provided by livekit-agents framework
    """
    # Get the room name (call_id) for file storage
    call_id = ctx.room.name

    # Sanitize call_id to prevent path traversal attacks
    # Allow only alphanumeric characters, underscores, and hyphens
    safe_call_id = re.sub(r'[^a-zA-Z0-9_-]', '_', call_id)

    if safe_call_id != call_id:
        logger.warning(f"Room name sanitized: '{call_id}' -> '{safe_call_id}' (potential path traversal attempt)")

    logger.info(f"Agent starting in room: {call_id} (safe_id: {safe_call_id})")

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
        
        redis_client = redis.Redis(**redis_kwargs)
        # Ping returns a coroutine, but type checker may not know this
        ping_result = await redis_client.ping()  # type: ignore[misc]
        conversation_store = ConversationStore(
            redis_client=redis_client,
            call_id=call_id,
            ttl=config.conversation_ttl,
            max_history=config.max_conversation_history,
            openai_client=None,  # Will be set after AI manager initializes
            model=config.azure_openai_model,  # Use same model as agent
        )
        logger.info(f"[REDIS] Connected to Redis at {config.redis_host}:{config.redis_port} (TLS: {config.redis_tls})")
    except Exception as e:
        logger.error(f"[REDIS] Failed to connect to Redis: {e}. Conversation history will not be persisted.")
        conversation_store = None

    # Initialize modules
    event_bus = EventBus()
    
    # Initialize MultiUserTranscriber with built-in STT (replaces EarModule)
    # Uses livekit-agents built-in VAD + Azure OpenAI Whisper STT
    multi_user_transcriber = MultiUserTranscriber(
        ctx=ctx,
        event_bus=event_bus,
        azure_endpoint=config.azure_stt_endpoint,
        azure_api_key=config.azure_stt_api_key,
        azure_api_version=config.azure_stt_api_version,
        azure_deployment=config.azure_stt_model,  # Model name is deployment name for Azure
        vad_activation_threshold=config.vad_activation_threshold,
        vad_min_speech_duration=config.vad_min_speech_duration,
        vad_min_silence_duration=config.vad_min_silence_duration,
        vad_prefix_padding_duration=0.5,  # Pre-buffer 500ms to capture speech onset
    )

    # Initialize GCS bucket provider (lazy initialization)
    gcs_provider = GCSBucketProvider(
        project_id=config.gcs_project_id,
        bucket_name=config.gcs_bucket_name,
    )
    bucket = gcs_provider.get_bucket()
    
    # Log GCS initialization status
    if bucket:
        logger.info(f"GCS bucket initialized: {config.gcs_bucket_name} (project: {config.gcs_project_id})")
    else:
        logger.warning(f"GCS bucket NOT initialized - project_id={config.gcs_project_id}, bucket_name={config.gcs_bucket_name}")

    # Initialize transcription storage (GCS with buffer, or local fallback)
    use_buffer = bucket is not None  # Always buffer when GCS is available
    transcription_storage = TranscriptionStorage(
        call_id=call_id,
        safe_call_id=safe_call_id,
        bucket=bucket,
        use_buffer=use_buffer,
    )

    # Initialize AI Session Manager
    ai_manager = AISessionManager(
        config=config,
        conversation_store=conversation_store,
        ai_voice_enabled_default=config.ai_voice_enabled_default,
    )
    
    # Initialize Azure services (TTS/LLM)
    azure_initialized = await ai_manager.initialize_azure_services()
    if not azure_initialized:
        logger.warning("Azure services initialization failed - AI features may be limited")
    
    # Set OpenAI client in conversation store for LLM-based compaction
    if conversation_store and ai_manager.llm:
        from openai import AsyncAzureOpenAI
        # Create AsyncAzureOpenAI client reusing the same config as ai_manager
        conversation_store.openai_client = AsyncAzureOpenAI(
            api_key=config.azure_openai_api_key,
            azure_endpoint=config.azure_openai_endpoint,
            api_version="2024-10-21",
        )
        logger.info("[REDIS] OpenAI client configured for conversation compaction")

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
    )
    
    # Subscribe to transcription events
    event_bus.subscribe("TRANSCRIPTION", transcription_handler.handle)

    # Subscribe to AI action events (for frontend popup triggers like invite user)
    async def handle_ai_action(data: dict):
        """Publish AI action events to frontend via LiveKit data channel"""
        # Get current controller to target HITL actions
        controller_info = ai_manager.get_controller_info()
        controller_id = controller_info.get("controller_id")
        await publisher.publish_action(data, controller_id=controller_id)
    
    event_bus.subscribe("AI_ACTION", handle_ai_action)

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
    
    # Set the participant name to "Xyne Automatic"
    await ctx.room.local_participant.set_name("Xyne Automatic")

    # Extract room context from metadata for tool use
    room_metadata = {}
    try:
        if ctx.room.metadata:
            room_metadata = json.loads(ctx.room.metadata)
            logger.info(f"Room metadata loaded: {room_metadata.keys()}")
    except Exception as e:
        logger.warning(f"Could not parse room metadata: {e}")
    
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
    logger.info(
        f"Call context: callId={call_context.call_id}, "
        f"channelId={call_context.channel_id}, "
        f"boardId={call_context.board_id}, "
        f"participants={list(call_context.participant_map.keys())}"
    )

    # Set room context and create AgentSession with tools
    ai_manager.room_context = call_context.to_room_context()
    
    # Validate call context for tool use
    if not call_context.is_valid_for_tools():
        if not call_context.channel_id:
            logger.warning("Missing 'channelId' - ticket creation may fail")
        if not call_context.board_id:
            logger.warning("Missing 'boardId' - ticket creation may fail")
        if not call_context.backend_url:
            logger.warning("Missing 'backend_url' - ticket creation will fail")
        if not call_context.api_key:
            logger.warning("Missing 'api_key' - ticket creation will fail")
    
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
        logger.info("Linked AgentSession to MultiUserTranscriber for speech interruption")

    # Initialize cleanup manager
    webhook = WebhookNotifier(config.backend_url, config.transcription_agent_api_key)
    participant_tracker = ParticipantTracker()
    
    # Note: We'll pass stt_tasks after RoomLifecycle creates them
    cleanup_manager = CleanupManager(
        call_id=call_id,
        stt_tasks={},  # Will be updated by room_lifecycle
        storage=transcription_storage,
        webhook=webhook,
        room=ctx.room,
        conversation_store=conversation_store,
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
    logger.info("Agent ready - listening for audio")

    # Simple wait - let the agent run until LiveKit disconnects it
    # Cleanup happens in participant_disconnected handler before disconnect
    try:
        await asyncio.Future()  # Wait forever until cancelled
    except asyncio.CancelledError:
        logger.info("Agent cancelled, exiting gracefully")


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
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
