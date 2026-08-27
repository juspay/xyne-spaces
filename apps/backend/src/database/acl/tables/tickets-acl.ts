import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getAccessibleTicketIds,
  getConnectAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class TicketsACL extends BaseQueryACL<
  Prisma.TicketWhereInput,
  Prisma.TicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput> {
    const ctx = this.ctx
    // Slack-Connect: tickets on connect channels the caller is an active member of, across orgs.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectBranch: Prisma.TicketWhereInput = { channelId: { in: connectChannelIds } }

    if (isGuestContext(ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          {
            workspaceId: this.ctx.workspaceId ?? '',
            id: { in: ticketIds },
          },
          connectBranch,
        ],
      }
    }

    return {
      OR: [{ workspaceId: this.ctx.workspaceId }, connectBranch],
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.TicketUncheckedCreateInput): Promise<boolean> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId },
      select: { isArchived: true },
    })
    if (channel?.isArchived) return false
    return true
  }
}
