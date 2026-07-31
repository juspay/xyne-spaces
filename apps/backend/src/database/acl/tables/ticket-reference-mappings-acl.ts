import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketReferenceMappingsACL extends BaseQueryACL<
  Prisma.TicketReferenceMappingWhereInput,
  Prisma.TicketReferenceMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketReferenceMappingWhereInput> {
    return {
      sourceTicket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketReferenceMappingWhereInput> {
    const workspaceId = this.ctx.workspaceId
    return {
      workspaceId,
      sourceTicket: {
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

  async canCreate(data: Prisma.TicketReferenceMappingUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: data.sourceTicketId,
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
