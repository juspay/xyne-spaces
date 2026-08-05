import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

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
      ticket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketAssignmentWhereInput> {
    // Writes match reads: a workspace-only clause here would let any member mutate rows
    // belonging to channels they cannot read.
    return this.getWhereClause()
  }

  async canCreate(data: Prisma.TicketAssignmentUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: data.ticketId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return ticket !== null
  }
}
