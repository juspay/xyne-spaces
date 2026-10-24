import type { Prisma } from '@prisma/client';
import { BaseQueryACL } from '../base-acl';
import { pollChannelWhere, pollResultVisibilityWhere } from './poll-acl-helpers';

/** Result rows are written only by the vote mutators; request principals cannot write them. */
export class PollQuestionResultsACL extends BaseQueryACL<
  Prisma.PollQuestionResultWhereInput,
  Prisma.PollQuestionResultUncheckedCreateInput
> {
  async getWhereClause(): Promise<Prisma.PollQuestionResultWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: {
        AND: [
          await pollChannelWhere(this.ctx, this.prisma),
          pollResultVisibilityWhere(this.ctx.userId),
        ],
      },
    };
  }

  async getMutateWhere(): Promise<Prisma.PollQuestionResultWhereInput> {
    return { questionId: { in: [] } };
  }

  async canCreate(): Promise<boolean> {
    return false;
  }
}
