import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserGroupMappingsACL extends BaseQueryACL<Prisma.UserGroupMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserGroupMappingWhereInput> {
    return {
      userGroup: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
