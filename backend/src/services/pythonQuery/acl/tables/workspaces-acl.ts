import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Workspaces ACL for Python Query Service
 * Controls read access to workspaces based on user role
 * Returns active workspaces in orgs where user is a member
 * Uses status field (indexable) instead of leftAt (not indexable)
 */
export class WorkspacesACL extends BaseQueryACL<Prisma.WorkspaceWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkspaceWhereInput> {
    return {
      status: 'ACTIVE',
      organization: {
        members: {
          some: {
            memberId: this.ctx.memberId,
          },
        },
      },
    }
  }
}
