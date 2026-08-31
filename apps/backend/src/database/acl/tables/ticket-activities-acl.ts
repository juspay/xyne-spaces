import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketActivitiesACL extends BaseQueryACL<
  Prisma.TicketActivityWhereInput,
  Prisma.TicketActivityUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketActivityWhereInput> {
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
  async getMutateWhere(): Promise<Prisma.TicketActivityWhereInput> {
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

  async canCreate(data: Prisma.TicketActivityUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: data.ticketId,
        workspaceId: this.ctx.workspaceId,
        channel: {
          OR: [
            {
              visibility: 'PRIVATE',
              participants: { some: { userId: this.ctx.userId } },
            },
            {
              visibility: 'PUBLIC',
              project: {
                channels: {
                  some: {
                    visibility: 'PUBLIC',
                    participants: { some: { userId: this.ctx.userId } },
                  },
                },
              },
            },
          ],
        },
      },
      select: { id: true },
    })
    return ticket !== null
  }
}
