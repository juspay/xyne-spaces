import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class UserExpertiseMappingsACL extends BaseQueryACL<Prisma.UserExpertiseMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserExpertiseMappingWhereInput> {
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('id')
    }

    return {
      userGroup: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
