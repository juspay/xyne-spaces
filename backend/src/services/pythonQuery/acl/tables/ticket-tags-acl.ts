import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketTagsACL extends BaseQueryACL<Prisma.TicketTagWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketTagWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
