import { MessageType } from '@xyne/shared';
import { findOrCreateConversation } from '@/apps/core/conversationUtils';
import { addReactionAsUser } from '@/services/reactionService';
import { ContentFormat } from '@/apps/types';

/**
 * The draft as it goes out. People mentions stay, so it can point at who owns something.
 * A mention of an agent would start that agent's run, and @channel or @here would ping
 * everyone, so those become plain text.
 */
const withoutBroadcastOrAgents = (text: string, agentUserIds: Set<string>): string =>
  text
    .replace(
      /<span\b[^>]*\bdata-user-id=["']([^"']+)["'][^>]*>@?([^<]*)<\/span>/gi,
      (whole, userId: string, name: string) => (agentUserIds.has(userId) ? name : whole)
    )
    .replace(/(^|\s)@(channel|here|everyone)\b/gi, '$1$2');

/** Post the agent's answer in the asker's thread, as its own bot. Returns the message id. */
export async function postAnswer(input: {
  channelId: string;
  conversationId: string;
  agentUserId: string;
  text: string;
  agentUserIds: Set<string>;
}): Promise<string> {
  const result = await findOrCreateConversation(
    input.channelId,
    input.agentUserId,
    withoutBroadcastOrAgents(input.text, input.agentUserIds),
    true,
    input.conversationId,
    undefined,
    MessageType.BOT,
    { contentFormat: ContentFormat.MARKDOWN }
  );
  return result.messageId;
}

/** A 👍 from the agent on an answer that already says what its draft would have. */
export async function reactAgreement(agentUserId: string, messageId: string): Promise<void> {
  await addReactionAsUser(messageId, agentUserId, '👍');
}
