import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketStageEtaACL extends BaseQueryACL<
  Prisma.TicketStageEtaWhereInput,
  Prisma.TicketStageEtaUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketStageEtaWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
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
  async getMutateWhere(): Promise<Prisma.TicketStageEtaWhereInput> {
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

  async canCreate(data: Prisma.TicketStageEtaUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: data.ticketId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return ticket !== null
  }
}
