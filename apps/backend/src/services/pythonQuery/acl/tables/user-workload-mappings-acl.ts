import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserWorkloadMappingsACL extends BaseQueryACL<Prisma.UserWorkloadMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserWorkloadMappingWhereInput> {
    return {
      userGroup: {
        workspaceId: this.ctx.workspaceId ?? '',
        userGroupMappings: { some: { userId: this.ctx.userId } },
      },
    }
  }
}
