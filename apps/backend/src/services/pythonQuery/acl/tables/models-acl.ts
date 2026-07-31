import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ModelsACL extends BaseQueryACL<Prisma.ModelWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ModelWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
