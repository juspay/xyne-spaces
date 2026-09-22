import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketTagsACL extends BaseQueryACL<
  Prisma.TicketTagWhereInput,
  Prisma.TicketTagUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketTagWhereInput> {
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

  /** Tickets the caller reaches by participating in the ticket's channel. */
  private participationArms(): Prisma.TicketWhereInput[] {
    return [
      {
        channel: {
          visibility: 'PRIVATE',
          participants: { some: { userId: this.ctx.userId } },
        },
      },
      {
        channel: {
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
      },
    ]
  }

  async getMutateWhere(): Promise<Prisma.TicketTagWhereInput> {
    const workspaceId = this.ctx.workspaceId
    const byParticipation: Prisma.TicketTagWhereInput = {
      ticket: { workspaceId, OR: this.participationArms() },
    }

    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId,
        OR: [byParticipation, { ticketId: { in: ticketIds } }],
      }
    }

    return { workspaceId, ...byParticipation }
  }

  async canCreate(data: Prisma.TicketTagUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: data.ticketId,
        workspaceId: this.ctx.workspaceId,
        OR: this.participationArms(),
      },
      select: { id: true },
    })
    if (ticket !== null) return true
    if (!isGuestContext(this.ctx)) return false
    const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)
    return ticketIds.includes(data.ticketId)
  }
}
