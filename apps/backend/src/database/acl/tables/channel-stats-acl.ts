import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelStatsACL extends BaseQueryACL<
  Prisma.ChannelStatsWhereInput,
  Prisma.ChannelStatsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelStatsWhereInput> {
    return {
      channel: {
        OR: [
          { visibility: 'PUBLIC' },
          { participants: { some: { userId: this.ctx.userId } } },
        ],
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelStatsWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      channel: { participants: { some: { userId: this.ctx.userId } } },
    }
  }

  async canCreate(_data: Prisma.ChannelStatsUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
