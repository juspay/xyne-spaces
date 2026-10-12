import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleCollectionRootIds } from '../util/collection-access-helper'

export class CollectionsACL extends BaseQueryACL<
  Prisma.CollectionWhereInput,
  Prisma.CollectionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionWhereInput> {
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'read')
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ id: { in: rootIds } }, { rootCollectionId: { in: rootIds } }],
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionWhereInput> {
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'write')
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ id: { in: rootIds } }, { rootCollectionId: { in: rootIds } }],
    }
  }
}
