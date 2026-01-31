import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds } from './channel-access-helper'

export class TicketsACL extends BaseQueryACL<Prisma.TicketWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput | null> {
    // Get all accessible channel IDs and filter tickets directly
    const accessibleChannelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId)

    return {
      channelId: { in: accessibleChannelIds },
    }
  }
}
