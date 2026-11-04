import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { requireAccessiblePoll, requirePollCreatorForDelete } from './poll-acl-utils';

export class PollQuestionResultsMutationACL extends BaseACL<'poll_question_results'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'poll_question_results'>>[0]) {
    super(ctx, 'poll_question_results');
  }

  async canInsert(
    args: InsertValue<TableSchema<'poll_question_results'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Poll result must use the current workspace',
        'poll_question_results'
      );
    }
    const poll = await requireAccessiblePoll(args.pollId, this.ctx, tx, 'poll_question_results');
    const question = await tx.run(zql.poll_questions.where('id', '=', args.questionId).one());
    if (
      poll.createdBy !== this.ctx.userID ||
      !question ||
      question.pollId !== poll.id ||
      question.workspaceId !== this.ctx.workspaceId
    ) {
      throw new MutationACLError(
        'Only the poll author can initialize its result row',
        'poll_question_results'
      );
    }
    if (
      args.voterCount !== 0 ||
      args.ratingTotal !== 0 ||
      Object.keys(args.optionCounts).length > 0 ||
      Object.keys(args.rankTotals).length > 0
    ) {
      throw new MutationACLError('Poll result rows must start empty', 'poll_question_results');
    }
  }

  /** Voters' mutators recompute the row from ballots after each vote or response. */
  async canUpdate(
    args: UpdateValue<TableSchema<'poll_question_results'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const result = await tx.run(
      zql.poll_question_results.where('questionId', '=', args.questionId).one()
    );
    if (!result || result.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll result not found in this workspace', 'poll_question_results');
    }
    await requireAccessiblePoll(result.pollId, this.ctx, tx, 'poll_question_results');
  }

  async canDelete(
    args: DeleteID<TableSchema<'poll_question_results'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const result = await tx.run(
      zql.poll_question_results.where('questionId', '=', args.questionId).one()
    );
    if (!result) {
      throw new MutationACLError('Poll result does not exist', 'poll_question_results');
    }
    await requirePollCreatorForDelete(result.pollId, this.ctx, tx, 'poll_question_results');
  }
}
