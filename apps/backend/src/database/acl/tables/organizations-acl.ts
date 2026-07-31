import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

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
    if (isGuestContext(this.ctx)) {
      return denyGuestWhere('orgId')
    }

    // Without a resolved memberId, scope to nothing so results stay bounded to the caller's org.
    if (!this.ctx.memberId) {
      return { orgId: { in: [] } }
    }
    // Org role (ADMIN/OWNER) is an intra-org tier, not a platform-admin grant — an admin
    // may only see the org(s) they are an active member of.
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
    if (!this.ctx.memberId) {
      return { orgId: { in: [] } }
    }
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      // Admins/owners may mutate only the org(s) they belong to — not every tenant's org.
      return {
        members: {
          some: {
            memberId: this.ctx.memberId,
            leftAt: null,
          },
        },
      }
    }
    return { createdBy: this.ctx.userId }
  }

  async canCreate(_data: Prisma.OrganizationUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
