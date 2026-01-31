import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class OrgMembersACL extends BaseQueryACL<Prisma.OrgMemberWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrgMemberWhereInput | null> {
    return {
      userId: this.ctx.userId,
    }
  }
}
