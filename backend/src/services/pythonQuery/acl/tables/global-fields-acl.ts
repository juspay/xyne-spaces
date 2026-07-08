import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class GlobalFieldsACL extends BaseQueryACL<Prisma.GlobalFieldWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.GlobalFieldWhereInput> {
    // Definitions are project-scoped; project.workspaceId keeps workspace isolation.
    return { project: { workspaceId: this.ctx.workspaceId ?? '' } }
  }
}
