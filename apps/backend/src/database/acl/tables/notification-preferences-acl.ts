import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class NotificationPreferencesACL extends BaseQueryACL<
  Prisma.NotificationPreferenceWhereInput,
  Prisma.NotificationPreferenceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.NotificationPreferenceWhereInput | null> {
    return {
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.NotificationPreferenceWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId }
  }

  async canCreate(data: Prisma.NotificationPreferenceUncheckedCreateInput): Promise<boolean> {
    return data.userId === this.ctx.userId
  }
}
