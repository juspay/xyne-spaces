import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class AgentsACL extends BaseQueryACL<Prisma.AgentWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AgentWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
