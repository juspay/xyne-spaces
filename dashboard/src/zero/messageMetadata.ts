import type { Transaction } from '@rocicorp/zero';
import {
  MessageType,
  Schema,
  addReactionToData,
  parseReactionsMd,
  removeReactionFromData,
  serializeReactionsMd,
  serializeRepliesMd,
} from '@xyne/shared';
import { zql } from './queries';

export const isChatMessageType = (type: MessageType | null | undefined) =>
  type === MessageType.USER || type === MessageType.FORWARDED;

export async function updateReactionsMd(
  tx: Transaction<Schema>,
  messageId: string,
  emojiName: string,
  userId: string,
  action: 'add' | 'remove',
): Promise<void> {
  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message || !isChatMessageType(message.msgType)) {
    return;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updated =
    action === 'add'
      ? addReactionToData(data, emojiName, userId)
      : removeReactionFromData(data, emojiName, userId);
  const updatedMd = serializeReactionsMd(updated);

  if (updatedMd !== message.reactions_md) {
    await tx.mutate.messages.update({
      messageId,
      reactions_md: updatedMd,
    });
  }
}

export function buildRepliesMdFromMessages(
  messages: Array<{
    messageId: string;
    senderId: string;
    createdAt: number;
    isDeleted: boolean;
    msgType: MessageType;
  }>,
  initialMessageId: string,
): string | null {
  const replyMessages = messages
    .filter(
      message =>
        !message.isDeleted &&
        message.messageId !== initialMessageId &&
        isChatMessageType(message.msgType),
    )
    .sort((a, b) => a.createdAt - b.createdAt);

  let repliers: string[] = [];
  for (const message of replyMessages) {
    repliers = repliers.filter(id => id !== message.senderId);
    repliers.push(message.senderId);
  }

  return serializeRepliesMd({ repliers });
}
