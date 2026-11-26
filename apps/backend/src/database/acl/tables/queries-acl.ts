import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { editableDashboardIds, readableDashboardIds } from './analytics-dashboard-access'

/**
 * A saved analytics query (widget) is visible to its creator and to anyone who can see a
 * dashboard it is on; it can be changed by its creator or an editor of such a dashboard (mirrors
 * the Zero ACLs).
 */
export class QueriesACL extends BaseQueryACL<
  Prisma.QueryWhereInput,
  Prisma.QueryUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  private async queryIdsOn(dashboardIds: string[]): Promise<string[]> {
    if (dashboardIds.length === 0) return []
    const rows = await this.prisma.dashboardQueryMapping.findMany({
      where: { workspaceId: this.ctx.workspaceId, dashboardId: { in: dashboardIds } },
      select: { queryId: true },
    })
    return rows.map(r => r.queryId)
  }

  async getWhereClause(): Promise<Prisma.QueryWhereInput> {
    const dashboards = await readableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ createdBy: this.ctx.userId }, { id: { in: await this.queryIdsOn(dashboards) } }],
    }
  }

  async getMutateWhere(): Promise<Prisma.QueryWhereInput> {
    const dashboards = await editableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ createdBy: this.ctx.userId }, { id: { in: await this.queryIdsOn(dashboards) } }],
    }
  }

  async canCreate(data: Prisma.QueryUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId && data.createdBy === this.ctx.userId
  }
}
