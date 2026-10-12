import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleCollectionRootIds } from '../util/collection-access-helper'

export class CollectionPermissionsACL extends BaseQueryACL<
  Prisma.CollectionPermissionWhereInput,
  Prisma.CollectionPermissionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionPermissionWhereInput> {
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'read')
    return {
      workspaceId: this.ctx.workspaceId,
      collection: { OR: [{ id: { in: rootIds } }, { rootCollectionId: { in: rootIds } }] },
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionPermissionWhereInput> {
    // Granting/revoking access is itself a write on the collection — only an editor/owner
    // may change who else can see it, not merely whoever can see the collection's content.
    const rootIds = await getAccessibleCollectionRootIds(this.prisma, this.ctx.userId, this.ctx.workspaceId, 'write')
    return {
      workspaceId: this.ctx.workspaceId,
      collection: { OR: [{ id: { in: rootIds } }, { rootCollectionId: { in: rootIds } }] },
    }
  }
}
