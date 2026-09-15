import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RecapsACL extends BaseQueryACL<
  Prisma.RecapWhereInput,
  Prisma.RecapUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.RecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
