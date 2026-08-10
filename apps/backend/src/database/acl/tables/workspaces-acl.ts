import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

/**
 * Workspaces ACL for Python Query Service
 * Controls read access to workspaces based on user role
 * Returns active workspaces in orgs where user is a member
 * Uses status field (indexable) instead of leftAt (not indexable)
 */
export class WorkspacesACL extends BaseQueryACL<
  Prisma.WorkspaceWhereInput,
  Prisma.WorkspaceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkspaceWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      return denyGuestWhere('id')
    }

    // Fall back to the caller's own workspace when no membership is resolved.
    if (!this.ctx.memberId) {
      return { id: this.ctx.workspaceId }
    }
    return {
      // The caller's session workspace is always readable. Org membership records one org
      // per email (org_members.email is unique), while users can belong to workspaces in
      // other orgs — for those sessions the membership clause below can never match, and
      // hiding the caller's own workspace breaks every lookup that resolves it (e.g. app
      // creation resolving the owning org).
      OR: [
        { id: this.ctx.workspaceId },
        {
          status: 'ACTIVE',
          organization: {
            members: {
              some: {
                memberId: this.ctx.memberId,
                // Only active memberships (leftAt null) grant access to the org's workspaces.
                leftAt: null,
              },
            },
          },
        },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.WorkspaceWhereInput> {
    if (this.ctx.role !== 'ADMIN' && this.ctx.role !== 'OWNER') {
      return { id: { in: [] } }
    }
    return { id: this.ctx.workspaceId }
  }

}
