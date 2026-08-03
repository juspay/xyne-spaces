import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class SubTicketsACL extends BaseQueryACL<
  Prisma.SubTicketWhereInput,
  Prisma.SubTicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SubTicketWhereInput> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          { mappedTicketId: { in: ticketIds } },
          { ticketMappings: { some: { ticketId: { in: ticketIds } } } },
        ],
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.SubTicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { mappedTicketId: null },
        {
          mappedTicket: {
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
        },
      ],
    }
  }

  async canCreate(data: Prisma.SubTicketUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
