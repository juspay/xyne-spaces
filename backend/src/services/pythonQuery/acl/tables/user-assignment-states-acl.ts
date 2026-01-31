import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getUserGroupIds } from './user-group-helper'

export class UserAssignmentStatesACL extends BaseQueryACL<Prisma.UserAssignmentStateWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserAssignmentStateWhereInput | null> {
    const userGroupIds = await getUserGroupIds(this.prisma, this.ctx.userId)

    return {
      userGroupId: { in: userGroupIds },
    }
  }
}
