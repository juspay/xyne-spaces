import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class DashboardsACL extends BaseQueryACL<
  Prisma.DashboardWhereInput,
  Prisma.DashboardUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.DashboardWhereInput> {
    // Scope via creator.workspaceId (Dashboard has no direct workspaceId).
    const users = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { createdBy: { in: users.map((u) => u.id) } }
  }

  async getMutateWhere(): Promise<Prisma.DashboardWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.DashboardUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
