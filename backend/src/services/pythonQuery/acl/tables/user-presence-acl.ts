import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserPresenceACL extends BaseQueryACL<Prisma.UserPresenceWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserPresenceWhereInput | null> {
    // No restriction - open access (matches Zero's behavior)
    return null
  }
}
