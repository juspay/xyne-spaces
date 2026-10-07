/**
 * Conversation id prefixes that are NOT user-facing chat threads:
 *
 *   app_        an artifact app invoking an agent of its own
 *   a2a_        a call-agent delegation
 *   scheduled_  a cron firing
 *
 * All three share the assistant-result path with real chats, so every surface
 * that lists, names or materializes "your chats" has to exclude them.
 *
 * Lives here rather than beside any one caller because the check was copied
 * three times with three different prefix lists — the chat list omitted
 * `scheduled_`, the artifact-app guard omitted `a2a_` — so the same
 * conversation could be hidden from the sidebar and still spend a completion
 * on a title. One list means the next prefix is added once.
 */
export const NON_CHAT_CONVERSATION_PREFIXES = ["app_", "a2a_", "scheduled_"] as const;

export function isChatConversation(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  return !NON_CHAT_CONVERSATION_PREFIXES.some((prefix) => conversationId.startsWith(prefix));
}

/**
 * A conversation minted by a direct chat surface (claw v3 chat, Ask AI, the
 * sidebar) — `chat-<uuid>`. Only these can hold turns from several agents the
 * user switched between, so only these get the conversation-wide reads,
 * deletes and the one-title-per-conversation rule. Spaces thread ids are left
 * alone: a thread shares its id with a mentioned user's digital twin, whose
 * rows must stay out of the host agent's window.
 */
export function isDirectChatConversation(conversationId: string | null | undefined): boolean {
  return typeof conversationId === "string" && conversationId.startsWith("chat-");
}
