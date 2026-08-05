import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class AgentStepsACL extends BaseQueryACL<Prisma.AgentStepWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AgentStepWhereInput> {
      return { workspaceId: this.ctx.workspaceId }
  }
}
