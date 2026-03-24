import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  addReactionToData,
  parseReactionsMd,
  removeReactionFromData,
  serializeReactionsMd,
} from '@xyne/shared';
import type { ReactionPreviousValue } from '../types';
import { BaseMutationSyncHandler } from '../base-handler';

export class ReactionsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleReactionInsert(args, tx);
  }

  async onDelete(
    args: unknown,
    tx: Transaction<Schema>,
    previousValue?: unknown
  ): Promise<void> {
    await handleReactionDelete(args, tx, previousValue);
  }
}

async function handleReactionInsert(
  args: unknown,
  tx: Transaction<Schema>
): Promise<void> {
  const typedArgs = args as {
    messageId?: string;
    emojiName?: string;
    userId?: string;
  } | undefined;

  const messageId = typedArgs?.messageId;
  const emojiName = typedArgs?.emojiName;
  const reactingUserId = typedArgs?.userId;

  if (!messageId || !emojiName || !reactingUserId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message) {
    return;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updatedData = addReactionToData(data, emojiName, reactingUserId);
  const updatedMd = serializeReactionsMd(updatedData);

  await tx.mutate.messages.update({
    messageId,
    reactions_md: updatedMd,
  });

  return;
}

async function handleReactionDelete(
  _args: unknown,
  tx: Transaction<Schema>,
  previousValue?: unknown
): Promise<void> {
  const reaction = previousValue as ReactionPreviousValue | undefined;
  if (!reaction?.messageId || !reaction.emojiName || !reaction.userId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', reaction.messageId).one());
  if (!message) {
    return;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updatedData = removeReactionFromData(data, reaction.emojiName, reaction.userId);
  const updatedMd = serializeReactionsMd(updatedData);

  await tx.mutate.messages.update({
    messageId: reaction.messageId,
    reactions_md: updatedMd,
  });

  return;
}
