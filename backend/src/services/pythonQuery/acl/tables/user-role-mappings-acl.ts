import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class UserRoleMappingsACL extends BaseQueryACL<Prisma.UserRoleMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserRoleMappingWhereInput> {
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('id')
    }

    return {
      role: {
        workspaceId: this.ctx.workspaceId ?? '',
        isActive: true,
      },
    }
  }
}
