import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketActivitiesACL extends BaseQueryACL<
  Prisma.TicketActivityWhereInput,
  Prisma.TicketActivityUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketActivityWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketActivityWhereInput> {
    return { workspaceId: this.ctx.workspaceId, id: { in: [] } }
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
