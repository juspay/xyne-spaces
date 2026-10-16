import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Credential storage for OrgMember (passwordHash, moved out of the public-schema, Zero-synced
 * org_members table — see [ticket/doc]). Deliberately self-only: no ADMIN/OWNER carve-out like
 * OrgMembersACL has, because a credential is not an org-visible attribute the way role/email
 * are. A caller may only see or touch their OWN row.
 *
 * Admin-initiated writes to another member's row (e.g. invitationService.generateOrgMemberPassword,
 * which sets a temp password for an invitee who hasn't logged in yet) cannot go through this ACL
 * — ctx.memberId there is the inviter, not the target — and must use a bypassAcl system/service
 * write instead.
 */
export class OrgMemberCredentialsACL extends BaseQueryACL<
  Prisma.OrgMemberCredentialWhereInput,
  Prisma.OrgMemberCredentialUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  private scope(): Prisma.OrgMemberCredentialWhereInput {
    // No memberId in context ⇒ scope to nothing, the fail-closed default used elsewhere
    // (see OrgMembersACL) for "caller has no member identity to scope by".
    if (!this.ctx.memberId) {
      return { memberId: { in: [] } }
    }
    return { memberId: this.ctx.memberId }
  }

  async getWhereClause(): Promise<Prisma.OrgMemberCredentialWhereInput> {
    return this.scope()
  }

  async getMutateWhere(): Promise<Prisma.OrgMemberCredentialWhereInput> {
    return this.scope()
  }

  async canCreate(data: Prisma.OrgMemberCredentialUncheckedCreateInput): Promise<boolean> {
    return !!this.ctx.memberId && data.memberId === this.ctx.memberId
  }
}
