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

    // Without a memberId, scope to nothing so results stay bounded to the caller's orgs.
    if (!this.ctx.memberId) {
      return { id: { in: [] } }
    }
    return {
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
    }
  }

  async getMutateWhere(): Promise<Prisma.WorkspaceWhereInput> {
    if (this.ctx.role === 'ADMIN' || this.ctx.role === 'OWNER') {
      return { id: this.ctx.workspaceId }
    }
    return { id: { in: [] } }
  }

  async canCreate(_data: Prisma.WorkspaceUncheckedCreateInput): Promise<boolean> {
    return false
  }
}
