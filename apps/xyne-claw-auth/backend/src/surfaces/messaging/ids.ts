/**
 * How a chat maps to a conversation. Pure string work, kept apart from
 * dispatch.ts because that module reaches object storage the moment it is
 * imported — and the commands that need an id (/new) have no business
 * standing that up.
 */
import { ACCOUNT_KEY_PREFIX } from "./const.js";
import { MESSAGING_CHANNEL_KEYS, type MessagingChannelKey } from "./plugin.js";
import { sanitizeId } from "./schema.js";

/**
 * Deterministic conversation id: DMs collapse per sender, groups per chat,
 * and each agent keeps its own history (OpenClaw's per-agent session keying)
 * so `/other-agent` does not inherit the default agent's transcript.
 */
export function channelConversationId(
  channel: MessagingChannelKey,
  accountKey: string,
  agentSlug: string,
  chatId: string,
): string {
  return `${channel}-${sanitizeId(accountKey)}-${sanitizeId(agentSlug)}-${sanitizeId(chatId)}`;
}

/**
 * The channel a conversation id was minted for, or null when it is not a chat
 * conversation. Longest key first: "whatsapp-cloud-…" also starts with
 * "whatsapp-".
 */
export function channelOfConversationId(conversationId: string | null | undefined): MessagingChannelKey | null {
  if (!conversationId) return null;
  const keys = [...MESSAGING_CHANNEL_KEYS].sort((a, b) => b.length - a.length);
  return keys.find((key) => conversationId.startsWith(`${key}-${ACCOUNT_KEY_PREFIX}`)) ?? null;
}

/**
 * A conversation id for one concurrent task inside a chat. It extends the
 * chat's own id with a task discriminator, so each task gets its own runtime
 * session and its own busy slot (both keyed off the conversation id) while
 * still delivering to the same chat. Only the threaded WhatsApp path mints
 * these; every other surface keeps using {@link channelConversationId}.
 */
export function taskConversationId(
  channel: MessagingChannelKey,
  accountKey: string,
  agentSlug: string,
  chatId: string,
  taskId: string,
): string {
  return `${channelConversationId(channel, accountKey, agentSlug, chatId)}-t-${sanitizeId(taskId)}`;
}
