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

  /** Same scope as reads. notificationRepository has bare-id update/delete/updateStatus
   *  methods, so without this any workspace member could act on another user's row. */
  async getMutateWhere(): Promise<Prisma.NotificationWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId }
  }
}
