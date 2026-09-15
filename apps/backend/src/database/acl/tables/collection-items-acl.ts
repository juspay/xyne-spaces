import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CollectionItemsACL extends BaseQueryACL<
  Prisma.CollectionItemWhereInput,
  Prisma.CollectionItemUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionItemWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionItemWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
