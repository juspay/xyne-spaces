import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RecurringCallSeriesACL extends BaseQueryACL<
  Prisma.RecurringCallSeriesWhereInput,
  Prisma.RecurringCallSeriesUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RecurringCallSeriesWhereInput> {
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { channelId: { in: channels.map((c) => c.id) } }
  }

  async getMutateWhere(): Promise<Prisma.RecurringCallSeriesWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.RecurringCallSeriesUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
