import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UsersACL extends BaseQueryACL<Prisma.UserWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
