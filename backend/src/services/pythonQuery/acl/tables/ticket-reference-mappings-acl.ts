import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketReferenceMappingsACL extends BaseQueryACL<Prisma.TicketReferenceMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketReferenceMappingWhereInput> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          { sourceTicketId: { in: ticketIds } },
          { targetTicketId: { in: ticketIds } },
        ],
      }
    }

    return {
      sourceTicket: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
