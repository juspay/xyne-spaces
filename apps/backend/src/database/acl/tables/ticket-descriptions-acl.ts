import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class TicketDescriptionsACL extends BaseQueryACL<
  Prisma.TicketDescriptionWhereInput,
  Prisma.TicketDescriptionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketDescriptionWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        channelId: { in: channelIds },
      }
    }

    const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

    return {
      workspaceId: this.ctx.workspaceId,
      channelId: { in: channelIds },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketDescriptionWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId,
        channelId: { in: channelIds },
      }
    }

    const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

    return {
      workspaceId: this.ctx.workspaceId,
      channelId: { in: channelIds },
    }
  }

  async canCreate(_data: Prisma.TicketDescriptionUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
