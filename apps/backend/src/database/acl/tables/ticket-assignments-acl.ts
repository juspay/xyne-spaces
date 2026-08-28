import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketAssignmentsACL extends BaseQueryACL<
  Prisma.TicketAssignmentWhereInput,
  Prisma.TicketAssignmentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketAssignmentWhereInput> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        ticketId: { in: ticketIds },
      }
    }

    return {
      ticket: await accessibleTicketWhere(this.prisma, this.ctx),
    }
  }

  /** Mirrors the read clause: a no-op update returns the row, so a wider mutate scope leaks it. */
  async getMutateWhere(): Promise<Prisma.TicketAssignmentWhereInput> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId,
        ticketId: { in: ticketIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
      ticket: await accessibleTicketWhere(this.prisma, this.ctx),
    }
  }

  /** Gated on reachability, not just tenancy. Mirrors TicketTagsACL.canCreate. */
  async canCreate(data: Prisma.TicketAssignmentUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    // Guests first: the non-guest predicate's PUBLIC arm would pass them on any PUBLIC channel.
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)
      return ticketIds.includes(data.ticketId)
    }
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        AND: [{ id: data.ticketId }, await accessibleTicketWhere(this.prisma, this.ctx)],
      },
      select: { id: true },
    })
    return ticket !== null
  }
}
