import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RolesACL extends BaseQueryACL<Prisma.RoleWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RoleWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId ?? '',
      isActive: true,
    }
  }
}
