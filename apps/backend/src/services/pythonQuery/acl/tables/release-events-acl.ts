import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReleaseEventsACL extends BaseQueryACL<Prisma.ReleaseEventWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReleaseEventWhereInput> {
    // Scope via release ticket workspaceId.
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })
    return { releaseId: { in: tickets.map((t) => t.id) } }
  }
}
