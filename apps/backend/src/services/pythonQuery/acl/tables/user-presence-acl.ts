import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserPresenceACL extends BaseQueryACL<Prisma.UserPresenceWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserPresenceWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
