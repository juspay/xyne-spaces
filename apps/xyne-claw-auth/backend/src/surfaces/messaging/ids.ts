/**
 * How a chat maps to a conversation. Pure string work, kept apart from
 * dispatch.ts because that module reaches object storage the moment it is
 * imported — and the commands that need an id (/new) have no business
 * standing that up.
 */
import type { MessagingChannelKey } from "./plugin.js";
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
