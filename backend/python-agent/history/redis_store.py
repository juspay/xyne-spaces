"""
Redis-based conversation history storage with chronological ordering
"""
import json
import time
from typing import Optional
import redis.asyncio as redis
from livekit.agents import AgentSession, llm
from openai import AsyncAzureOpenAI
import logging

logger = logging.getLogger(__name__)


class ConversationStore:
    """
    Redis-backed conversation history store with chronological ordering.
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        call_id: str,
        ttl: int = 43200,
        max_history: int = 100,
        openai_client: Optional[AsyncAzureOpenAI] = None,
        model: str = "gpt-4o-mini",
    ):
        self.redis_client = redis_client
        self.call_id = call_id
        self.ttl = ttl
        self.max_history = max_history
        self.openai_client = openai_client
        self.model = model
        self.key = f"call:{call_id}:conversation"

    async def add_entry(self, entry: dict) -> None:
        try:
            spoken_at = entry.get("spoken_at", time.time())
            json_entry = json.dumps(entry)

            await self.redis_client.zadd(self.key, {json_entry: spoken_at})

            key_exists = await self.redis_client.exists(self.key)
            if key_exists == 1:
                await self.redis_client.expire(self.key, self.ttl)

            set_size = await self.redis_client.zcard(self.key)
            if set_size > self.max_history:
                await self._compact_with_llm()

        except Exception as e:
            logger.error(f"[REDIS] Error storing conversation entry: {e}", exc_info=True)

    async def _compact_with_llm(self) -> None:
        try:
            if self.openai_client is None:
                await self._compact_simple()
                return

            all_entries = await self.redis_client.zrange(self.key, 0, -1, withscores=True)
            if len(all_entries) <= self.max_history:
                return

            split_point = len(all_entries) // 2
            old_entries = all_entries[:split_point]

            old_messages = []
            for entry_json, _ in old_entries:
                try:
                    old_messages.append(json.loads(entry_json))
                except json.JSONDecodeError:
                    continue

            if not old_messages:
                await self._compact_simple()
                return

            conversation_text = "\n".join(
                f"{msg.get('user', 'Unknown')}: {msg.get('text', '')}"
                for msg in old_messages
            )

            try:
                response = await self.openai_client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a conversation summarizer. Summarize the following conversation "
                                "in 2-3 sentences, preserving key topics, decisions, and action items."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Summarize this conversation:\n\n{conversation_text}",
                        },
                    ],
                    temperature=0.3,
                    max_tokens=200,
                )
                summary = response.choices[0].message.content or "Previous conversation occurred."
            except Exception as e:
                logger.error(f"[REDIS] LLM summarization failed: {e}", exc_info=True)
                summary = f"Previous conversation with {len(old_messages)} messages occurred."

            earliest_timestamp = old_entries[0][1]
            summary_entry = {
                "user": "System",
                "text": f"[Previous conversation summary: {summary}]",
                "timestamp": earliest_timestamp,
                "spoken_at": earliest_timestamp,
                "participant_identity": "system",
                "source": "system",
                "role": "system",
            }

            await self.redis_client.zremrangebyrank(self.key, 0, split_point - 1)
            await self.redis_client.zadd(
                self.key, {json.dumps(summary_entry): earliest_timestamp}
            )

        except Exception as e:
            logger.error(f"[REDIS] Error during LLM compaction: {e}", exc_info=True)
            await self._compact_simple()

    async def _compact_simple(self) -> None:
        try:
            set_size = await self.redis_client.zcard(self.key)
            if set_size > self.max_history:
                entries_to_remove = set_size - self.max_history
                await self.redis_client.zremrangebyrank(self.key, 0, entries_to_remove - 1)
        except Exception as e:
            logger.error(f"[REDIS] Error during simple compaction: {e}", exc_info=True)

    async def restore_to_session(
        self,
        agent_session: AgentSession,
        agent,
        max_messages: Optional[int] = None,
    ) -> int:
        try:
            max_messages = max_messages or 20
            entries = await self.redis_client.zrange(self.key, 0, -1)

            if not entries:
                return 0

            parsed_entries = []
            for entry_json in entries:
                try:
                    parsed_entries.append(json.loads(entry_json))
                except json.JSONDecodeError:
                    continue

            # Restore all messages (user AND assistant) to maintain conversation continuity
            # System messages (summaries) are excluded as they're not part of the conversation flow
            conversation_messages = [
                e for e in parsed_entries 
                if e.get("role") in ("user", "assistant")
            ]
            messages_to_restore = conversation_messages[-max_messages:]

            if not messages_to_restore:
                return 0

            chat_ctx = llm.ChatContext.empty()
            for entry in messages_to_restore:
                role = entry.get("role", "user")
                user = entry.get("user", "Unknown")
                text = entry["text"]
                
                content = f"[{user}]: {text}"    
                chat_ctx.add_message(role=role, content=content)

            await agent.update_chat_ctx(chat_ctx)

            return len(messages_to_restore)

        except Exception as e:
            logger.error(f"[REDIS] Error restoring conversation history: {e}", exc_info=True)
            return 0

    async def delete(self) -> None:
        try:
            await self.redis_client.delete(self.key)
        except Exception as e:
            logger.error(f"[REDIS] Error deleting conversation history: {e}", exc_info=True)
