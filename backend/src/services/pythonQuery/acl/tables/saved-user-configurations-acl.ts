import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * ACL for Saved Views (parent config rows).
 *
 * A user may read a Saved View if, within their own workspace, they own it OR
 * it is shared PUBLIC. saved_user_configurations has no workspaceId column, so
 * the workspace boundary is enforced through the owning user's workspace
 * (same pattern as UserProfilesACL / UserPreferencesACL). This prevents PUBLIC
 * views from other workspaces being read cross-tenant.
 */
export class SavedUserConfigurationsACL extends BaseQueryACL<Prisma.SavedUserConfigurationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SavedUserConfigurationWhereInput> {
    // Fail closed: without a workspace we only ever expose the caller's own views.
    if (!this.ctx.workspaceId) {
      return { userId: this.ctx.userId }
    }

    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const userIds = workspaceUsers.map(u => u.id)

    return {
      // Hard workspace boundary: only views owned by users in this workspace.
      userId: { in: userIds },
      // Within the workspace: your own views, plus PUBLIC (shared) views.
      OR: [{ userId: this.ctx.userId }, { visibility: 'PUBLIC' }],
    }
  }
}
