import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserGroupsACL extends BaseQueryACL<Prisma.UserGroupWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserGroupWhereInput | null> {
    // No restriction - open access (matches Zero's behavior)
    return null
  }
}
