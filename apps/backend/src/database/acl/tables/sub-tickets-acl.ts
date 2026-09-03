import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { accessibleTicketWhere, getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

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

    // SubTicket holds its own title/description. Reachable through either end; createSubTicket
    // writes the parent mapping in the same transaction, so every row has one.
    const accessible = await accessibleTicketWhere(this.prisma, this.ctx)

    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { mappedTicket: accessible },
        { ticketMappings: { some: { ticket: accessible } } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.SubTicketWhereInput> {
    const arms: Prisma.SubTicketWhereInput[] = [
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
    ]

    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      arms.push(
        { mappedTicketId: { in: ticketIds } },
        { ticketMappings: { some: { ticketId: { in: ticketIds } } } }
      )
    }

    return {
      workspaceId: this.ctx.workspaceId,
      OR: arms,
    }
  }

  async canCreate(data: Prisma.SubTicketUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
