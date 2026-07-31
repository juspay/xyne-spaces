import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class DashboardQueriesMappingACL extends BaseQueryACL<
  Prisma.dashboardQueryMappingWhereInput,
  Prisma.dashboardQueryMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.dashboardQueryMappingWhereInput> {
    // Scope via dashboard → creator workspace.
    const users = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const dashboards = await this.prisma.dashboard.findMany({
      where: { createdBy: { in: users.map((u) => u.id) } },
      select: { id: true },
    })
    return { dashboardId: { in: dashboards.map((d) => d.id) } }
  }

  async getMutateWhere(): Promise<Prisma.dashboardQueryMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.dashboardQueryMappingUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
