import type { Prisma } from '@prisma/client';
import { BaseQueryACL } from '../base-acl';
import { pollChannelWhere } from './poll-acl-helpers';

export class PollQuestionsACL extends BaseQueryACL<
  Prisma.PollQuestionWhereInput,
  Prisma.PollQuestionUncheckedCreateInput
> {
  async getWhereClause(): Promise<Prisma.PollQuestionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: await pollChannelWhere(this.ctx, this.prisma),
    };
  }

  async getMutateWhere(): Promise<Prisma.PollQuestionWhereInput> {
    return { workspaceId: this.ctx.workspaceId, poll: { createdBy: this.ctx.userId } };
  }

  async canCreate(data: Prisma.PollQuestionUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false;
    const poll = await this.prisma.poll.findFirst({
      where: { id: data.pollId, createdBy: this.ctx.userId },
      select: { id: true },
    });
    return poll !== null;
  }
}
