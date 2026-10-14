import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';
import type { QueryContext } from '../core/types';
import { MutationACLError } from '../core/types';

export async function requireAccessiblePoll(
  pollId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string,
  { allowDeletedMessage = false }: { allowDeletedMessage?: boolean } = {},
) {
  const poll = await tx.run(
    zql.polls
      .where('id', '=', pollId)
      .related('message', (message) => message.related('conversation'))
      .one(),
  );
  const channelId = poll?.message?.conversation?.channelId;

  if (!poll || poll.workspaceId !== ctx.workspaceId || !channelId) {
    throw new MutationACLError('Poll not found in this workspace', tableName);
  }

  if (poll.message?.isDeleted && !allowDeletedMessage) {
    throw new MutationACLError('This poll message was deleted', tableName);
  }

  if (!(await hasChannelMutationAccess(ctx, tx, channelId))) {
    throw new MutationACLError('Poll mutation requires channel access', tableName);
  }

  return poll;
}

/** Poll rows are removed only by `deletePollGraph`, which runs for the poll creator. */
export async function requirePollCreatorForDelete(
  pollId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string,
) {
  const poll = await requireAccessiblePoll(pollId, ctx, tx, tableName, {
    allowDeletedMessage: true,
  });
  if (poll.createdBy !== ctx.userID) {
    throw new MutationACLError('Only the poll creator can delete poll data', tableName);
  }
  return poll;
}
