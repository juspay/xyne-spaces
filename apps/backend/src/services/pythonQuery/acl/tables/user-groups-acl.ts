import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class UserGroupsACL extends BaseQueryACL<Prisma.UserGroupWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserGroupWhereInput> {
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('id')
    }

    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
