import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

/**
 * Reads and writes both use `accessibleTicketWhere`; `workspaceId` alone let any member read
 * every board's tickets, and left the read filter bypassable by writing.
 */
export class TicketsACL extends BaseQueryACL<
  Prisma.TicketWhereInput,
  Prisma.TicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: ticketIds },
      }
    }

    return accessibleTicketWhere(this.prisma, this.ctx)
  }

  async getMutateWhere(): Promise<Prisma.TicketWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId,
        id: { in: ticketIds },
      }
    }

    return accessibleTicketWhere(this.prisma, this.ctx)
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
