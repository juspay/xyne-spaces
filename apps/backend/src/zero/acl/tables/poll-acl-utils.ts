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

  if (poll.message?.isDeleted) {
    throw new MutationACLError('This poll message was deleted', tableName);
  }

  if (!(await hasChannelMutationAccess(ctx, tx, channelId))) {
    throw new MutationACLError('Poll mutation requires channel access', tableName);
  }

  return poll;
}
