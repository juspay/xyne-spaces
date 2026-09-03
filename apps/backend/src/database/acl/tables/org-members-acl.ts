import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * OrgMembers ACL for Python Query Service
 * Controls read access to org_members based on user role
 */
export class OrgMembersACL extends BaseQueryACL<
  Prisma.OrgMemberWhereInput,
  Prisma.OrgMemberUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrgMemberWhereInput> {
    // Without a memberId, scope to nothing so results stay bounded to the caller's org.
    if (!this.ctx.memberId) {
      return { memberId: { in: [] } }
    }
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      // See all members of the caller's OWN org(s) — scoped via the organization relation,
      // NOT every tenant's members. Org role is intra-org, not platform admin.
      return {
        organization: {
          members: { some: { memberId: this.ctx.memberId, leftAt: null } },
        },
      }
    }
    return {
      memberId: this.ctx.memberId,
    }
  }

  async getMutateWhere(): Promise<Prisma.OrgMemberWhereInput> {
    if (!this.ctx.memberId) {
      return { memberId: { in: [] } }
    }
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      return {
        organization: {
          members: { some: { memberId: this.ctx.memberId, leftAt: null } },
        },
      }
    }
    return { memberId: this.ctx.memberId }
  }

  async canCreate(data: Prisma.OrgMemberUncheckedCreateInput): Promise<boolean> {
    if (data.email) {
      const currentUser = await this.prisma.user.findFirst({
        where: { id: this.ctx.userId },
        select: { email: true },
      })
      if (data.email === currentUser?.email && data.role === 'OWNER') {
        const org = await this.prisma.organization.findFirst({
          where: { orgId: data.orgId },
          select: { createdBy: true },
        })
        if (org && org.createdBy === this.ctx.userId) {
          return true
        }
      }
    }

    if (this.ctx.orgRole !== 'ADMIN' && this.ctx.orgRole !== 'OWNER') {
      return false
    }

    const existingMembership = await this.prisma.orgMember.findFirst({
      where: { email: data.email, leftAt: null },
      select: { orgId: true },
    })
    if (existingMembership && existingMembership.orgId !== data.orgId) {
      return false
    }
    return true
  }
}
