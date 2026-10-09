import type { InsertValue, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { requireAccessiblePoll } from './poll-acl-utils';

export class PollOptionsACL extends BaseACL<'poll_options'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'poll_options'>>[0]) {
    super(ctx, 'poll_options');
  }

  async canInsert(
    args: InsertValue<TableSchema<'poll_options'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId || args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Poll choice must use the current user and workspace', 'poll_options');
    }
    const question = await tx.run(
      zql.poll_questions.where('id', '=', args.questionId).one(),
    );
    if (!question || question.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll question not found in this workspace', 'poll_options');
    }
    const poll = await requireAccessiblePoll(question.pollId, this.ctx, tx, 'poll_options');
    if (poll.createdBy !== this.ctx.userID && !poll.allowAudienceChoices) {
      throw new MutationACLError('This poll does not allow audience choices', 'poll_options');
    }
  }
}
