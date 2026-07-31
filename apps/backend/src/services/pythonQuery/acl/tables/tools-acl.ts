import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ToolsACL extends BaseQueryACL<Prisma.ToolWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ToolWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
