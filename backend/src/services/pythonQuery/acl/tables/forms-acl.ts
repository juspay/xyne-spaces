import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class FormsACL extends BaseQueryACL<Prisma.FormWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormWhereInput> {
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('id')
    }

    // Direct workspaceId check - no user lookup needed
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
