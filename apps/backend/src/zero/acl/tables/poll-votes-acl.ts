import type {
  DeleteID,
  InsertValue,
  Transaction,
  UpdateValue,
  UpsertValue,
} from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';
import { requireAccessiblePoll } from './poll-acl-utils';

export class PollVotesACL extends BaseACL<'poll_votes'> {
  constructor(ctx: ConstructorParameters<typeof BaseACL<'poll_votes'>>[0]) {
    super(ctx, 'poll_votes');
  }

  private validateOwnerAndWorkspace(args: {
    userId: string;
    workspaceId: string;
  }): void {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('You can only modify your own ballot', 'poll_votes');
    }
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll ballot not found in this workspace', 'poll_votes');
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'poll_votes'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    this.validateOwnerAndWorkspace(args);
    const poll = await requireAccessiblePoll(args.pollId, this.ctx, tx, 'poll_votes');
    const question = await tx.run(
      zql.poll_questions.where('id', '=', args.questionId).one(),
    );
    if (!question || question.pollId !== poll.id || question.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Poll question not found in this workspace', 'poll_votes');
    }
  }

  async canUpsert(
    args: UpsertValue<TableSchema<'poll_votes'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.canInsert(args, tx);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'poll_votes'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const vote = await tx.run(zql.poll_votes.where('id', '=', args.id).one());
    if (!vote) {
      throw new MutationACLError('Poll ballot does not exist', 'poll_votes');
    }
    this.validateOwnerAndWorkspace(vote);
    await requireAccessiblePoll(vote.pollId, this.ctx, tx, 'poll_votes');
  }

  async canDelete(
    args: DeleteID<TableSchema<'poll_votes'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const vote = await tx.run(zql.poll_votes.where('id', '=', args.id).one());
    if (!vote) {
      throw new MutationACLError('Poll ballot does not exist', 'poll_votes');
    }
    this.validateOwnerAndWorkspace(vote);
    await requireAccessiblePoll(vote.pollId, this.ctx, tx, 'poll_votes');
  }
}
