import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'


export class TicketDescriptionsACL extends BaseQueryACL<
  Prisma.TicketDescriptionWhereInput,
  Prisma.TicketDescriptionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketDescriptionWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        ticketId: { in: ticketIds },
      }
    }

    return { ticket: await accessibleTicketWhere(this.prisma, this.ctx) }
  }

  async getMutateWhere(): Promise<Prisma.TicketDescriptionWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId,
        ticketId: { in: ticketIds },
      }
    }

    return { ticket: await accessibleTicketWhere(this.prisma, this.ctx) }
  }


  async canCreate(data: Prisma.TicketDescriptionUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false

    const ticket = await this.prisma.ticket.findFirst({
      where: { ...(await accessibleTicketWhere(this.prisma, this.ctx)), id: data.ticketId },
      select: { id: true },
    })
    if (ticket !== null) return true

    if (!isGuestContext(this.ctx)) return false
    const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)
    return ticketIds.includes(data.ticketId)
  }
}
