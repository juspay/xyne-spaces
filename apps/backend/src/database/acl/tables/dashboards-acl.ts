import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { editableDashboardIds, readableDashboardIds } from './analytics-dashboard-access'

/**
 * Legacy analytics dashboards are visible only to the people they are shared with (see
 * analytics-dashboard-access.ts; mirrors the Zero ACLs). Their saved filters can name customers
 * and people, so workspace scope alone is not enough. Owner-only deletion is enforced by the Zero
 * mutation ACL and the dashboards API.
 */
export class DashboardsACL extends BaseQueryACL<
  Prisma.DashboardWhereInput,
  Prisma.DashboardUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.DashboardWhereInput> {
    const ids = await readableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return { workspaceId: this.ctx.workspaceId, id: { in: ids } }
  }

  async getMutateWhere(): Promise<Prisma.DashboardWhereInput> {
    const ids = await editableDashboardIds(this.prisma, this.ctx.userId, this.ctx.workspaceId)
    return { workspaceId: this.ctx.workspaceId, id: { in: ids } }
  }

  async canCreate(data: Prisma.DashboardUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId && data.createdBy === this.ctx.userId
  }
}
