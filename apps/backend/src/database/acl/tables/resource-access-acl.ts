import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ResourceAccessACL extends BaseQueryACL<
  Prisma.ResourceAccessWhereInput,
  Prisma.ResourceAccessUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ResourceAccessWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ResourceAccessWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
