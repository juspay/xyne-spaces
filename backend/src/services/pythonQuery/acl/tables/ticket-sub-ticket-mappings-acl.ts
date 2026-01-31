import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

export class TicketSubTicketMappingsACL extends BaseQueryACL<Prisma.TicketSubTicketMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketSubTicketMappingWhereInput | null> {
    const accessibleTicketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId)

    return {
      ticketId: { in: accessibleTicketIds },
    }
  }
}
