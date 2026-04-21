import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class FormsACL extends BaseQueryACL<Prisma.FormWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormWhereInput> {
    // Direct workspaceId check - no user lookup needed
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
