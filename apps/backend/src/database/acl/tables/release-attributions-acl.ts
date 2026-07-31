import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReleaseAttributionsACL extends BaseQueryACL<
  Prisma.ReleaseAttributionWhereInput,
  Prisma.ReleaseAttributionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReleaseAttributionWhereInput> {
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { ticketId: { in: tickets.map((t) => t.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ReleaseAttributionWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ReleaseAttributionUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
