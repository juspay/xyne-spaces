import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * ACL for Saved View filter values (child rows).
 *
 * Values are scoped through their parent config: a user may read a value row
 * only if, within their own workspace, they own the parent config OR the parent
 * config is shared PUBLIC. The workspace boundary is enforced through the
 * parent config's owning user (saved_user_configurations has no workspaceId),
 * mirroring SavedUserConfigurationsACL so child rows cannot leak cross-tenant.
 */
export class SavedUserConfigurationValuesACL extends BaseQueryACL<Prisma.SavedUserConfigurationValueWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SavedUserConfigurationValueWhereInput> {
    // Fail closed: without a workspace we only ever expose the caller's own values.
    if (!this.ctx.workspaceId) {
      return { config: { userId: this.ctx.userId } }
    }

    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const userIds = workspaceUsers.map(u => u.id)

    return {
      config: {
        // Hard workspace boundary via the parent config's owner.
        userId: { in: userIds },
        // Within the workspace: own configs, plus PUBLIC (shared) configs.
        OR: [{ userId: this.ctx.userId }, { visibility: 'PUBLIC' }],
      },
    }
  }
}
