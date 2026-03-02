import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserAssignmentStatesACL extends BaseQueryACL<Prisma.UserAssignmentStateWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserAssignmentStateWhereInput | null> {
    return null
  }
}
