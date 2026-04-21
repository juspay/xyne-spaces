import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Workspace Organizations ACL for Python Query Service
 * Controls read access to workspace_organizations
 * Uses ctx.orgRole for fast role checks (no DB query needed)
 */
export class WorkspaceOrganizationsACL extends BaseQueryACL<Prisma.WorkspaceOrganizationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkspaceOrganizationWhereInput> {
    if (this.ctx.orgRole === 'ADMIN' || this.ctx.orgRole === 'OWNER') {
      return {}
    }
    if (this.ctx.workspaceId) {
      return { workspaceId: this.ctx.workspaceId }
    }

    return {}
  }
}
