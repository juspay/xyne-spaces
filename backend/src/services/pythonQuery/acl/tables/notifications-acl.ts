import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class NotificationsACL extends BaseQueryACL<Prisma.NotificationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.NotificationWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
