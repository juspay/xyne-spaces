import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleCollectionRootIds } from '../util/collection-access-helper'

export class CollectionItemsACL extends BaseQueryACL<
  Prisma.CollectionItemWhereInput,
  Prisma.CollectionItemUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionItemWhereInput> {
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'read')
    return {
      workspaceId: this.ctx.workspaceId,
      rootCollectionId: { in: rootIds },
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionItemWhereInput> {
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'write')
    return {
      workspaceId: this.ctx.workspaceId,
      rootCollectionId: { in: rootIds },
    }
  }
}
