import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SubTicketsACL extends BaseQueryACL<Prisma.SubTicketWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SubTicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
