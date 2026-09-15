import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ActivitiesACL extends BaseQueryACL<
  Prisma.ActivityWhereInput,
  Prisma.ActivityUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ActivityWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ActivityWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(_data: Prisma.ActivityUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
