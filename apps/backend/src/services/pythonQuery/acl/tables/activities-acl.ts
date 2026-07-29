import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ActivitiesACL extends BaseQueryACL<Prisma.ActivityWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ActivityWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
