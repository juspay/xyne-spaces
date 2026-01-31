import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

export class SubTicketsACL extends BaseQueryACL<Prisma.SubTicketWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SubTicketWhereInput | null> {
    // Get accessible ticket IDs
    const accessibleTicketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId)

    // Get sub-ticket IDs that are mapped to accessible tickets
    const accessibleMappings = await this.prisma.ticketSubTicketMapping.findMany({
      where: { ticketId: { in: accessibleTicketIds } },
      select: { subTicketId: true },
    })

    const accessibleSubTicketIds = accessibleMappings.map((m) => m.subTicketId)

    return {
      id: { in: accessibleSubTicketIds },
    }
  }
}
