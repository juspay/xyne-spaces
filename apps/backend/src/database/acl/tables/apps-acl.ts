import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class AppsACL extends BaseQueryACL<
  Prisma.AppsWhereInput,
  Prisma.AppsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AppsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.AppsWhereInput> {
    return { workspaceId: this.ctx.workspaceId, createdBy: this.ctx.userId }
  }

  async canCreate(_data: Prisma.AppsUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
