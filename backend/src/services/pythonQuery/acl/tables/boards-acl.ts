import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BoardsACL extends BaseQueryACL<Prisma.BoardWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardWhereInput> {
    // Direct workspaceId check - no need to traverse through project
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
