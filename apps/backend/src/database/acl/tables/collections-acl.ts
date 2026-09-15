import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CollectionsACL extends BaseQueryACL<
  Prisma.CollectionWhereInput,
  Prisma.CollectionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
