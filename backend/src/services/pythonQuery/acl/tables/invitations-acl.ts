import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Invitations ACL for Python Query Service
 * Controls read access to invitations based on user role
 * Only ADMIN or OWNER can see all invitations; others see only their own
 */
export class InvitationsACL extends BaseQueryACL<Prisma.InvitationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.InvitationWhereInput> {
    // Check if user is ADMIN or OWNER using ctx.role (from JWT, no DB query)
    if (this.ctx.role === 'ADMIN' || this.ctx.role === 'OWNER') {
      // ADMIN or OWNER can see all invitations in the workspace
      if (this.ctx.workspaceId) {
        return { workspaceId: this.ctx.workspaceId }
      }
      return {}
    }

    // Regular users can only see invitations they created or are invited to
    return {
      OR: [
        { invitedBy: this.ctx.userId },
        { email: this.ctx.userId }, // Assuming userId can be email for invited users
      ],
    }
  }
}
