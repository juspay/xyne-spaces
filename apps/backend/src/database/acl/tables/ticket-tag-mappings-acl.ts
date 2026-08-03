import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketTagMappingsACL extends BaseQueryACL<
  Prisma.TicketTagMappingWhereInput,
  Prisma.TicketTagMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketTagMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketTagMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
