import type { InsertValue, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';

import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { requireAccessiblePoll } from './poll-acl-utils';

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
      args.responseCount !== 0 ||
      args.rankResponseCount !== 0 ||
      args.ratingTotal !== 0 ||
      Object.keys(args.optionCounts).length > 0 ||
      Object.keys(args.rankTotals).length > 0 ||
      Object.keys(args.ratingCounts).length > 0
    ) {
      throw new MutationACLError('Poll result rows must start empty', 'poll_question_results');
    }
  }
}

export class PollJobsMutationACL extends BaseACL<'poll_jobs'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'poll_jobs'>>[0]) {
    super(ctx, 'poll_jobs');
  }

  async canInsert(
    args: InsertValue<TableSchema<'poll_jobs'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll job must use the current workspace', 'poll_jobs');
    }
    const poll = await requireAccessiblePoll(args.pollId, this.ctx, tx, 'poll_jobs');
    if (poll.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the poll author can schedule poll jobs', 'poll_jobs');
    }
    if (
      !['CLOSE', 'REMINDER'].includes(args.kind) ||
      args.status !== 'PENDING' ||
      args.attempts !== 0 ||
      args.maxAttempts !== 5 ||
      args.leaseOwner !== null ||
      args.leaseExpiresAt !== null ||
      args.completedAt !== null ||
      args.failedAt !== null ||
      args.lastError !== null
    ) {
      throw new MutationACLError('Poll jobs must use the initial lifecycle state', 'poll_jobs');
    }
  }
}
