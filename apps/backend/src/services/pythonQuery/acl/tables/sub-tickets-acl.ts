import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class SubTicketsACL extends BaseQueryACL<Prisma.SubTicketWhereInput> {
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
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
