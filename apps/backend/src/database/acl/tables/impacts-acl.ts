import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ImpactsACL extends BaseQueryACL<
  Prisma.ImpactWhereInput,
  Prisma.ImpactUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ImpactWhereInput> {
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { ticketId: { in: tickets.map((t) => t.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ImpactWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ImpactUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
