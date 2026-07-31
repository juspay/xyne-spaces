import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CoesACL extends BaseQueryACL<
  Prisma.COEWhereInput,
  Prisma.COEUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.COEWhereInput> {
    // Scope via rca → ticket.workspaceId.
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const rcas = await this.prisma.rCA.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) } },
      select: { id: true },
    })
    return { rcaId: { in: rcas.map((r) => r.id) } }
  }

  async getMutateWhere(): Promise<Prisma.COEWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.COEUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
