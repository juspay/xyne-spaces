import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * OrgMembers ACL for Python Query Service
 * Controls read access to org_members based on user role
 */
export class OrgMembersACL extends BaseQueryACL<Prisma.OrgMemberWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrgMemberWhereInput> {
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      return {}
    }
    return {
      memberId: this.ctx.memberId,
    }
  }
}
