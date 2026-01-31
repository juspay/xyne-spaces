import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class NotificationPreferencesACL extends BaseQueryACL<Prisma.NotificationPreferenceWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.NotificationPreferenceWhereInput | null> {
    return {
      userId: this.ctx.userId,
    }
  }
}
