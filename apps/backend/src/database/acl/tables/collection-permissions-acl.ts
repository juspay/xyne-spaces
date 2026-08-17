import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CollectionPermissionsACL extends BaseQueryACL<
  Prisma.CollectionPermissionWhereInput,
  Prisma.CollectionPermissionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CollectionPermissionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.CollectionPermissionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
