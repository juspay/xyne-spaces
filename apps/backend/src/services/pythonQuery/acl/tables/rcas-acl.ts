import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RcasACL extends BaseQueryACL<Prisma.RCAWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RCAWhereInput> {
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { id: true },
    })
    return { ticketId: { in: tickets.map((t) => t.id) } }
  }
}
