import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReleaseChangesACL extends BaseQueryACL<
  Prisma.ReleaseChangeWhereInput,
  Prisma.ReleaseChangeUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReleaseChangeWhereInput> {
    // Scope via release (Ticket) workspaceId.
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { releaseId: { in: tickets.map((t) => t.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ReleaseChangeWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ReleaseChangeUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
