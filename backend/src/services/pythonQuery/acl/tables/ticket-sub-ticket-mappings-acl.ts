import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketSubTicketMappingsACL extends BaseQueryACL<Prisma.TicketSubTicketMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketSubTicketMappingWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
