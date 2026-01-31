import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getUserGroupIds } from './user-group-helper'

export class UserExpertiseMappingsACL extends BaseQueryACL<Prisma.UserExpertiseMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserExpertiseMappingWhereInput | null> {
    const userGroupIds = await getUserGroupIds(this.prisma, this.ctx.userId)

    return {
      userGroupId: { in: userGroupIds },
    }
  }
}
