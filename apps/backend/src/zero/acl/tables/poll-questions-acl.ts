import type { InsertValue, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { requireAccessiblePoll } from './poll-acl-utils';

export class PollQuestionsACL extends BaseACL<'poll_questions'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'poll_questions'>>[0]) {
    super(ctx, 'poll_questions');
  }

  async canInsert(
    args: InsertValue<TableSchema<'poll_questions'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll question not found in this workspace', 'poll_questions');
    }
    const poll = await requireAccessiblePoll(args.pollId, this.ctx, tx, 'poll_questions');
    if (poll.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the poll author can add questions', 'poll_questions');
    }
  }
}
