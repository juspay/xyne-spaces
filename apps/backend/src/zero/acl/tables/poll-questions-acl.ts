import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { isPollClosed, type Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { requireAccessiblePoll, requirePollCreatorForDelete } from './poll-acl-utils';

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

  /** The only update is `polls.addOption` appending to `options`. */
  async canUpdate(
    args: UpdateValue<TableSchema<'poll_questions'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const question = await tx.run(zql.poll_questions.where('id', '=', args.id).one());
    if (!question || question.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll question not found in this workspace', 'poll_questions');
    }
    const poll = await requireAccessiblePoll(question.pollId, this.ctx, tx, 'poll_questions');
    if (isPollClosed(poll)) {
      throw new MutationACLError('This poll is closed', 'poll_questions');
    }
    if (poll.createdBy !== this.ctx.userID && !poll.allowAudienceChoices) {
      throw new MutationACLError('This poll does not allow audience options', 'poll_questions');
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'poll_questions'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const question = await tx.run(zql.poll_questions.where('id', '=', args.id).one());
    if (!question) {
      throw new MutationACLError('Poll question does not exist', 'poll_questions');
    }
    await requirePollCreatorForDelete(question.pollId, this.ctx, tx, 'poll_questions');
  }
}
