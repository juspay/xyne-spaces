import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getUserGroupIds } from './user-group-helper'

export class BoardComplexityScoresACL extends BaseQueryACL<Prisma.BoardComplexityScoreWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardComplexityScoreWhereInput | null> {
    // Get all user group IDs that the user belongs to
    const userGroupIds = await getUserGroupIds(this.prisma, this.ctx.userId)

    return {
      userGroupId: { in: userGroupIds },
    }
  }
}
