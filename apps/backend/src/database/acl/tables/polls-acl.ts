import type { Prisma } from '@prisma/client';
import { BaseQueryACL } from '../base-acl';
import { pollChannelWhere } from './poll-acl-helpers';

export class PollsACL extends BaseQueryACL<Prisma.PollWhereInput, Prisma.PollUncheckedCreateInput> {
  async getWhereClause(): Promise<Prisma.PollWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      ...(await pollChannelWhere(this.ctx, this.prisma)),
    };
  }

  async getMutateWhere(): Promise<Prisma.PollWhereInput> {
    return { workspaceId: this.ctx.workspaceId, createdBy: this.ctx.userId };
  }

  async canCreate(data: Prisma.PollUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId || data.createdBy !== this.ctx.userId) {
      return false;
    }
    const message = await this.prisma.message.findFirst({
      where: { messageId: data.messageId, senderId: this.ctx.userId },
      select: { messageId: true },
    });
    return message !== null;
  }
}
