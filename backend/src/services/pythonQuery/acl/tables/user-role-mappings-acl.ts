import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserRoleMappingsACL extends BaseQueryACL<Prisma.UserRoleMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserRoleMappingWhereInput> {
    return {
      role: {
        workspaceId: this.ctx.workspaceId ?? '',
        isActive: true,
      },
    }
  }
}
