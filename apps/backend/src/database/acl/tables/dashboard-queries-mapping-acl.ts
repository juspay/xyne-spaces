import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { editableDashboardIds, readableDashboardIds } from './analytics-dashboard-access'

/** A mapping follows its dashboard: visible to its readers, changeable by its editors. */
export class DashboardQueriesMappingACL extends BaseQueryACL<
  Prisma.dashboardQueryMappingWhereInput,
  Prisma.dashboardQueryMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.dashboardQueryMappingWhereInput> {
    const ids = await readableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return { workspaceId: this.ctx.workspaceId, dashboardId: { in: ids } }
  }

  async getMutateWhere(): Promise<Prisma.dashboardQueryMappingWhereInput> {
    const ids = await editableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return { workspaceId: this.ctx.workspaceId, dashboardId: { in: ids } }
  }

  async canCreate(data: Prisma.dashboardQueryMappingUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const editable = await editableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    if (!editable.includes(data.dashboardId)) return false
    const query = await this.prisma.query.findFirst({
      where: { id: data.queryId, workspaceId: this.ctx.workspaceId },
      select: { createdBy: true },
    })
    if (!query) return false
    if (query.createdBy === this.ctx.userId) return true
    // Someone else's query may be placed only if it already sits on a dashboard the caller edits.
    const onEditable = await this.prisma.dashboardQueryMapping.findFirst({
      where: { queryId: data.queryId, dashboardId: { in: editable } },
      select: { id: true },
    })
    return onEditable !== null
  }
}
