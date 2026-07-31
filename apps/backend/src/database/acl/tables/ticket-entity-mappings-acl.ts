import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketEntityMappingsACL extends BaseQueryACL<
  Prisma.TicketEntityMappingWhereInput,
  Prisma.TicketEntityMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketEntityMappingWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketEntityMappingWhereInput> {
    const workspaceId = this.ctx.workspaceId
    return {
      workspaceId,
      ticket: {
        workspaceId,
        OR: [
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
        ],
      },
    }
  }

  async canCreate(data: Prisma.TicketEntityMappingUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: data.ticketId,
        workspaceId: this.ctx.workspaceId,
        OR: [
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
        ],
      },
      select: { id: true },
    })
    return ticket !== null
  }
}
