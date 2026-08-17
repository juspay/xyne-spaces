import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class QueriesACL extends BaseQueryACL<
  Prisma.QueryWhereInput,
  Prisma.QueryUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.QueryWhereInput> {
      return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.QueryWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.QueryUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
