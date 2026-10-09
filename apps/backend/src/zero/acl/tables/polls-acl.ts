import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';
import { requireAccessiblePoll } from './poll-acl-utils';

export class PollsACL extends BaseACL<'polls'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'polls'>>[0]) {
    super(ctx, 'polls');
  }

  async canInsert(
    args: InsertValue<TableSchema<'polls'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId || args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Poll insert must use the current user and workspace', 'polls');
    }
    const message = await tx.run(
      zql.messages
        .where('messageId', '=', args.messageId)
        .related('conversation')
        .one(),
    );
    const channelId = message?.conversation?.channelId;
    if (
      !message ||
      message.workspaceId !== this.ctx.workspaceId ||
      message.senderId !== this.ctx.userID ||
      !channelId ||
      !(await hasChannelMutationAccess(this.ctx, tx, channelId))
    ) {
      throw new MutationACLError('Poll insert requires an accessible message owned by the current user', 'polls');
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'polls'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const poll = await requireAccessiblePoll(args.id, this.ctx, tx, 'polls');
    if (poll.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the poll author can delete a poll', 'polls');
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'polls'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const poll = await requireAccessiblePoll(args.id, this.ctx, tx, 'polls');
    if (poll.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the poll author can update a poll', 'polls');
    }
  }
}
