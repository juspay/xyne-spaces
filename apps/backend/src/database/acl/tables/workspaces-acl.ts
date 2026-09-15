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
      status: 'ACTIVE',

      OR: [
        { id: this.ctx.workspaceId },
        {
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
        // Cross-org access recorded in workspace_organizations, where the join used it.
        {
          workspaceOrgs: {
            some: {
              leftAt: null,
              organization: {
                members: { some: { memberId: this.ctx.memberId, leftAt: null } },
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
