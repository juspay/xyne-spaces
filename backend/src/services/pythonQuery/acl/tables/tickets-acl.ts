import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketsACL extends BaseQueryACL<Prisma.TicketWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
