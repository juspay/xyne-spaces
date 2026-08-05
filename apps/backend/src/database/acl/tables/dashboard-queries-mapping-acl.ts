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
      return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.dashboardQueryMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.dashboardQueryMappingUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
