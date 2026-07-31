import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RecurringCallSeriesACL extends BaseQueryACL<Prisma.RecurringCallSeriesWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RecurringCallSeriesWhereInput> {
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })
    return { channelId: { in: channels.map((c) => c.id) } }
  }
}
