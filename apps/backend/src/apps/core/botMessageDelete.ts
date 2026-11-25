import { MessageType } from '@xyne/shared';
import { repositories } from '@/database/repositories';

/** Why a bot may not delete a message; each API answers these in its own wire format. */
export type BotMessageDeleteRefusal = 'not_found' | 'wrong_channel' | 'not_own';

export type BotMessageDeleteCheck =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; reason: BotMessageDeleteRefusal };

/**
 * Whether `botUserId` may delete `messageId`: the message exists, is in `channelId`, and is a
 * BOT message this app posted. The one check behind both doors: the native
 * POST /apps/chat/deleteMessage and the Slack-compatible POST /apps/slack/chat.delete.
 */
export async function checkBotMessageDelete(
  messageId: string,
  channelId: string,
  botUserId: string,
): Promise<BotMessageDeleteCheck> {
  const message = await repositories.messages.findById(messageId);
  if (!message) return { ok: false, reason: 'not_found' };

  const conversation = await repositories.conversations.findById(message.conversationId);
  if (!conversation || conversation.channelId !== channelId) return { ok: false, reason: 'wrong_channel' };

  if (message.senderId !== botUserId || message.msgType !== MessageType.BOT) {
    return { ok: false, reason: 'not_own' };
  }
  return { ok: true, alreadyDeleted: !!message.isDeleted };
}
