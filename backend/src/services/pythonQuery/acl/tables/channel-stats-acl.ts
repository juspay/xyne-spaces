import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelStatsACL extends BaseQueryACL<Prisma.ChannelStatsWhereInput> {
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
}
