import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ImpactsACL extends BaseQueryACL<Prisma.ImpactWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ImpactWhereInput> {
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })
    return { ticketId: { in: tickets.map((t) => t.id) } }
  }
}
