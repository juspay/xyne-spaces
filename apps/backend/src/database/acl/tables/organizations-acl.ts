import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Organizations ACL for Python Query Service
 * Controls read access to organizations based on user role
 * Uses ctx.orgRole for fast role checks (no DB traversal needed)
 */
export class OrganizationsACL extends BaseQueryACL<
  Prisma.OrganizationWhereInput,
  Prisma.OrganizationUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrganizationWhereInput> {
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      return {}
    }
    return {
      members: {
        some: {
          memberId: this.ctx.memberId,
          leftAt: null,
        },
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.OrganizationWhereInput> {
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      return {}
    }
    return { createdBy: this.ctx.userId }
  }

  async canCreate(_data: Prisma.OrganizationUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
