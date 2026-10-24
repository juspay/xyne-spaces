import type { Prisma } from '@prisma/client';
import { BaseQueryACL } from '../base-acl';
import { pollChannelWhere } from './poll-acl-helpers';

/** Ballots are readable by their voter, and by the creator of a non-anonymous poll. */
export class PollVotesACL extends BaseQueryACL<
  Prisma.PollVoteWhereInput,
  Prisma.PollVoteUncheckedCreateInput
> {
  async getWhereClause(): Promise<Prisma.PollVoteWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      AND: [
        { poll: await pollChannelWhere(this.ctx, this.prisma) },
        {
          OR: [
            { userId: this.ctx.userId },
            { poll: { createdBy: this.ctx.userId, isAnonymous: false } },
          ],
        },
      ],
    };
  }

  async getMutateWhere(): Promise<Prisma.PollVoteWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId };
  }

  async canCreate(data: Prisma.PollVoteUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId && data.userId === this.ctx.userId;
  }
}
