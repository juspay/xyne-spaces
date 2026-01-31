"""
AI Agent session lifecycle manager
"""
import asyncio
import json
import time
import logging
from typing import Optional, Callable, Any
from livekit import rtc
from livekit.agents import AgentSession, Agent
from livekit.agents.voice import room_io
from livekit.agents.voice.events import ConversationItemAddedEvent
from livekit.plugins import openai

from config import Config
from history import ConversationStore
from .instructions import AGENT_INSTRUCTIONS

logger = logging.getLogger(__name__)


class AISessionManager:
    """
    Manages AI agent lifecycle and state.
    """

    def __init__(
        self,
        config: Config,
        conversation_store: Optional[ConversationStore] = None,
        room_context: Optional[dict] = None,
        ai_voice_enabled_default: bool = True,
    ):
        self.config = config
        self.conversation_store = conversation_store
        self.room_context = room_context or {}

        self.ai_voice_enabled = ai_voice_enabled_default
        self.history_restored = False
        
        # Timestamp when AI voice was enabled - used to filter old messages
        # Only messages after this time (minus buffer) will trigger AI responses
        self._voice_enabled_at: float = time.time() if ai_voice_enabled_default else 0.0
        self._voice_enable_buffer: float = 3.0  # seconds buffer for processing delays
        
        # Controller tracking - which user currently controls the AI
        self.controller_participant_id: Optional[str] = None
        self.controller_name: Optional[str] = None

        self.tts: Optional[Any] = None
        self.llm: Optional[Any] = None
        self.agent_session: Optional[AgentSession] = None
        self.ai_agent: Optional[Agent] = None

        self._transcription_emitter: Optional[Callable] = None
        self._room: Optional[rtc.Room] = None

        logger.info(
            "AI session manager initialized (voice=%s)",
            "enabled" if self.ai_voice_enabled else "disabled",
        )

    def set_transcription_emitter(self, emitter: Callable):
        self._transcription_emitter = emitter

    async def initialize_azure_services(self) -> bool:
        if not self.config.azure_tts_endpoint or not self.config.azure_openai_api_key:
            return False

        try:
            self.tts = openai.TTS.with_azure(
                azure_endpoint=self.config.azure_tts_endpoint,
                azure_deployment=self.config.azure_tts_deployment,
                api_key=self.config.azure_tts_api_key,
                api_version=self.config.azure_tts_api_version,
                voice=self.config.azure_tts_voice,
            )

            self.llm = openai.LLM.with_azure(
                azure_endpoint=self.config.azure_openai_endpoint,
                azure_deployment=self.config.azure_openai_model,
                api_key=self.config.azure_openai_api_key,
                api_version=self.config.azure_openai_api_version,
            )

            logger.info("Azure TTS and LLM initialized successfully")
            return True

        except Exception as e:
            logger.error("Failed to initialize Azure services", exc_info=True)
            self.tts = None
            self.llm = None
            return False

    async def create_agent_session(self, tools: list) -> bool:
        if self.tts is None or self.llm is None:
            return False

        try:
            self.ai_agent = Agent(
                instructions=AGENT_INSTRUCTIONS,
                tools=tools,
            )

            self.agent_session = AgentSession(
                llm=self.llm,
                tts=self.tts,
            )

            logger.info("AI AgentSession created (tools=%d)", len(tools))
            return True

        except Exception:
            logger.error("Failed to create AgentSession", exc_info=True)
            self.agent_session = None
            self.ai_agent = None
            return False

    async def start_agent_session(self, room: rtc.Room) -> bool:
        self._room = room
        if self.agent_session is None or self.ai_agent is None:
            return False

        try:
            await self.agent_session.start(
                agent=self.ai_agent,
                room=room,
                room_options=room_io.RoomOptions(
                    audio_input=False,
                    audio_output=True,
                    text_input=True,
                    text_output=False,
                    close_on_disconnect=False,
                ),
            )

            self._setup_conversation_listener()
            await self._restore_history()

            if self.ai_voice_enabled:
                self.agent_session.say("Hello")

            logger.info("AI AgentSession started successfully")
            return True

        except Exception:
            logger.error("Failed to start AgentSession", exc_info=True)
            self.agent_session = None
            return False

    def _setup_conversation_listener(self):
        if self.agent_session is None:
            return

        @self.agent_session.on("conversation_item_added")
        def on_conversation_item_added(event: ConversationItemAddedEvent):
            async def handle_item():
                item = event.item

                if getattr(item, "role", None) != "assistant":
                    return

                ai_text = getattr(item, "text_content", None)
                if not ai_text:
                    return

                if self.conversation_store:
                    ts = time.time()
                    await self.conversation_store.add_entry(
                        {
                            "user": "Xyne Automatic",
                            "text": ai_text,
                            "timestamp": ts,
                            "spoken_at": ts,
                            "participant_identity": "ai-assistant",
                            "source": "ai",
                            "role": "assistant",
                        }
                    )

                if self._transcription_emitter:
                    await self._transcription_emitter(
                        "TRANSCRIPTION",
                        {
                            "user": "Xyne Automatic",
                            "text": ai_text,
                            "timestamp": time.time(),
                            "participant_identity": "ai-assistant",
                            "source": "ai",
                        },
                    )

            asyncio.create_task(handle_item())

    async def _restore_history(self):
        if self.history_restored or not self.agent_session:
            return

        if self.conversation_store:
            try:
                restored = await self.conversation_store.restore_to_session(
                    self.agent_session,
                    self.ai_agent,
                    max_messages=self.config.restore_last_n_messages,
                )
                if restored > 0:
                    self.history_restored = True
                    logger.info("Restored %d messages from conversation history", restored)
            except Exception:
                logger.error("Failed to restore conversation history", exc_info=True)

    async def handle_transcription(self, data: dict):
        if self.agent_session is None:
            return

        if data.get("source") == "ai":
            return

        state = self.agent_session.agent_state

        # Prepend participant name to transcript for LLM context
        # This allows LLM to distinguish between speakers in multi-participant calls
        participant_name = data.get("user", "Unknown")
        transcript_with_speaker = f"[{participant_name}]: {data['text']}"

        # Track current speaker's userId for tools (e.g., get_my_tickets)
        # participant_identity is the LiveKit identity which equals database userId
        participant_id = data.get("participant_identity")
        if participant_id and self.room_context:
            self.room_context["current_speaker_id"] = participant_id
            logger.debug(f"Updated current_speaker_id to {participant_id} ({participant_name})")

        # Always add to history for context (regardless of controller)
        # This ensures AI has full conversation context
        if state not in ("initializing", "closing"):
            try:
                self.agent_session.history.add_message(
                    role="user",
                    content=transcript_with_speaker,
                    created_at=data.get("spoken_at") or data.get("timestamp"),
                )
            except Exception:
                logger.error("Failed to add user message to history", exc_info=True)

        # Only route to LLM if AI is enabled AND controller is set AND speaker is controller
        if not self.ai_voice_enabled:
            return

        if state in ("initializing", "closing"):
            return

        # Check if there's a controller and if current speaker is the controller
        if self.controller_participant_id:
            if participant_id != self.controller_participant_id:
                # Not the controller - just added to history, don't generate response
                logger.debug(
                    "Skipping non-controller transcript (speaker=%s, controller=%s)",
                    participant_id, self.controller_participant_id
                )
                return
        else:
            # No controller set - don't generate response
            logger.debug("No controller set, skipping AI response")
            return

        # Filter out old messages that arrived before AI voice was enabled
        # This prevents the AI from acting on conversation history when first enabled
        message_time = data.get("spoken_at") or data.get("timestamp") or time.time()
        cutoff_time = self._voice_enabled_at - self._voice_enable_buffer
        
        if message_time < cutoff_time:
            # Old message - add to history for context but don't generate response
            logger.debug(
                "Skipping old message (time=%.2f < cutoff=%.2f): %s",
                message_time, cutoff_time, data.get("text", "")[:50]
            )
            return

        try:
            self.agent_session.generate_reply(user_input=transcript_with_speaker)
        except Exception:
            logger.error("Failed to generate AI response", exc_info=True)

    def handle_voice_toggle(self, enabled: bool, participant_id: Optional[str] = None, participant_name: Optional[str] = None):
        if enabled == self.ai_voice_enabled:
            return

        self.ai_voice_enabled = enabled
        
        if enabled:
            # Set controller when enabling
            if participant_id:
                self.controller_participant_id = participant_id
                self.controller_name = participant_name or "Unknown"
            # Record when voice was enabled - only respond to messages after this time
            self._voice_enabled_at = time.time()
            logger.info(
                "AI voice enabled by %s (%s)",
                self.controller_name if participant_id else "Unknown", 
                participant_id or "N/A"
            )
            # Restore conversation history when AI is enabled
            # This ensures the AI has context of messages spoken before it was turned on
            asyncio.create_task(self._restore_history())
            # Broadcast controller change
            asyncio.create_task(self._broadcast_controller_change())
        else:
            # Clear controller when disabling
            self.controller_participant_id = None
            self.controller_name = None
            # Reset history flag so we restore again when re-enabled
            self.history_restored = False
            logger.info("AI voice disabled")
            # Broadcast controller cleared
            asyncio.create_task(self._broadcast_controller_change())

        if enabled and self.agent_session and self.agent_session.agent_state != "initializing":
            # Greet when voice is enabled
            self.agent_session.say("I'm listening. How can I help?")
        elif not enabled:
            # Cancel any ongoing speech when voice is disabled
            self._cancel_ongoing_speech()

    def _cancel_ongoing_speech(self):
        """Cancel any ongoing AI speech using LiveKit's interrupt() API."""
        if not self.agent_session:
            logger.debug("No agent session to interrupt")
            return

        try:
            # Use LiveKit AgentSession.interrupt() - the correct API for stopping speech
            # force=True ensures even non-interruptible speech is stopped (user explicitly disabled AI)
            interrupt_future = self.agent_session.interrupt(force=True)
            logger.info("AI speech interruption triggered (force=True)")
            
            # Fire-and-forget: schedule the future to complete in background
            # We don't await since handle_voice_toggle is synchronous
            asyncio.create_task(self._wait_for_interrupt(interrupt_future))
        except RuntimeError as e:
            # AgentSession might not be running
            logger.warning(f"Could not interrupt AI speech: {e}")
        except Exception:
            logger.error("Failed to cancel ongoing AI speech", exc_info=True)

    async def _wait_for_interrupt(self, interrupt_future: "asyncio.Future[None]"):
        """Wait for interrupt to complete and log result."""
        try:
            await interrupt_future
            logger.debug("AI speech interruption completed successfully")
        except Exception:
            logger.error("AI speech interruption failed", exc_info=True)

    def get_agent_session(self) -> Optional[AgentSession]:
        return self.agent_session

    def is_ready(self) -> bool:
        return all(
            [
                self.tts,
                self.llm,
                self.agent_session,
                self.ai_agent,
            ]
        )

    async def _broadcast_controller_change(self):
        """Broadcast controller change to all participants."""
        if not self._room:
            return

        try:
            payload = {
                "type": "ai_controller_changed",
                "controller": self.controller_participant_id,
                "controllerName": self.controller_name,  # camelCase for TypeScript frontend
            }
            await self._room.local_participant.publish_data(
                json.dumps(payload).encode(),
                reliable=True,
            )
            logger.info(
                "Broadcasted controller change: %s (%s)",
                self.controller_name or "None",
                self.controller_participant_id or "None"
            )
        except Exception:
            logger.error("Failed to broadcast controller change", exc_info=True)

    async def send_controller_state_to_participant(self, participant_identity: str):
        """Send current controller state to a specific participant (for new joiners)."""
        if not self._room:
            return

        try:
            payload = {
                "type": "ai_controller_changed",
                "controller": self.controller_participant_id,
                "controllerName": self.controller_name,  # camelCase for TypeScript frontend
            }
            await self._room.local_participant.publish_data(
                json.dumps(payload).encode(),
                reliable=True,
                destination_identities=[participant_identity],
            )
            logger.info(
                "Sent controller state to new joiner %s: controller=%s",
                participant_identity,
                self.controller_name or "None"
            )
        except Exception:
            logger.error("Failed to send controller state to new joiner", exc_info=True)

    async def request_control(self, requester_id: str, requester_name: str):
        """Handle a control request from a participant."""
        if not self.controller_participant_id:
            # No current controller, grant control immediately
            self.controller_participant_id = requester_id
            self.controller_name = requester_name
            self.ai_voice_enabled = True
            self._voice_enabled_at = time.time()
            await self._broadcast_controller_change()
            logger.info("Control granted to %s (%s) - no previous controller", requester_name, requester_id)
            return True
        
        # Forward request to current controller AND broadcast pending state to all
        if self._room:
            try:
                # Send to controller for approval/deny
                controller_payload = {
                    "type": "ai_control_request_by_ai",
                    "requester_id": requester_id,
                    "requester_name": requester_name,
                }
                await self._room.local_participant.publish_data(
                    json.dumps(controller_payload).encode(),
                    reliable=True,
                    destination_identities=[self.controller_participant_id],
                )

                # Broadcast pending state to ALL participants
                pending_payload = {
                    "type": "ai_control_request_pending",
                    "requester_id": requester_id,
                    "requester_name": requester_name,
                }
                await self._room.local_participant.publish_data(
                    json.dumps(pending_payload).encode(),
                    reliable=True,
                )

                logger.info(
                    "Forwarded control request from %s to %s and broadcasted pending state to all",
                    requester_name, self.controller_name
                )
                return "forwarded"
            except Exception:
                logger.error("Failed to forward control request", exc_info=True)
        
        return False

    async def transfer_control(self, new_controller_id: str, new_controller_name: str):
        """Transfer control to a new participant."""
        old_controller = self.controller_name
        self.controller_participant_id = new_controller_id
        self.controller_name = new_controller_name
        self.ai_voice_enabled = True
        self._voice_enabled_at = time.time()
        await self._broadcast_controller_change()
        logger.info(
            "Control transferred from %s to %s",
            old_controller or "None", new_controller_name
        )

    async def release_control(self):
        """Release control (called when controller leaves)."""
        old_controller = self.controller_name
        self.controller_participant_id = None
        self.controller_name = None
        self.ai_voice_enabled = False
        await self._broadcast_controller_change()
        logger.info("Control released by %s", old_controller or "Unknown")

    def get_controller_info(self) -> dict:
        """Get current controller information."""
        return {
            "controller_id": self.controller_participant_id,
            "controller_name": self.controller_name,
            "is_enabled": self.ai_voice_enabled,
        }
