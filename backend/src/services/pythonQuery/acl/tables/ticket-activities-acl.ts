import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

export class TicketActivitiesACL extends BaseQueryACL<Prisma.TicketActivityWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketActivityWhereInput | null> {
    const accessibleTicketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId)

    return {
      ticketId: { in: accessibleTicketIds },
    }
  }
}
