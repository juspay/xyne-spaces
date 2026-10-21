import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * ACL for Saved View filter values (child rows).
 *
 * Values are scoped through their parent config: a user may read a value row
 * only if, within their own workspace, they own the parent config OR the parent
 * config is shared PUBLIC. Both rows carry their own denormalized workspaceId,
 * which enforces the workspace boundary directly, mirroring
 * SavedUserConfigurationsACL so child rows cannot leak cross-tenant.
 */
export class SavedUserConfigurationValuesACL extends BaseQueryACL<
  Prisma.SavedUserConfigurationValueWhereInput,
  Prisma.SavedUserConfigurationValueUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SavedUserConfigurationValueWhereInput> {
    // Fail closed: without a workspace we only ever expose the caller's own values.
    if (!this.ctx.workspaceId) {
      return { config: { userId: this.ctx.userId } }
    }

    // Channel grants store the channelId in view_access.entityId, so a member of
    // that channel may read the shared view's values.
    const channelIds = await this.getMemberChannelIds()

    return {
      // Hard workspace boundary: the row carries its own denormalized workspaceId.
      workspaceId: this.ctx.workspaceId,
      config: {
        workspaceId: this.ctx.workspaceId,
        // Within the workspace: own configs, PUBLIC configs, configs shared directly
        // with you, and configs shared with a channel you belong to.
        OR: [
          { userId: this.ctx.userId },
          { visibility: 'PUBLIC' },
          { viewAccess: { some: { entityType: 'USER', entityId: this.ctx.userId } } },
          ...(channelIds.length
            ? [
                {
                  viewAccess: {
                    some: { entityType: 'CHANNEL', entityId: { in: channelIds } },
                  },
                },
              ]
            : []),
        ],
      },
    }
  }

  private async getMemberChannelIds(): Promise<string[]> {
    const memberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })
    return memberships.map(m => m.channelId)
  }

  async getMutateWhere(): Promise<Prisma.SavedUserConfigurationValueWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      config: { userId: this.ctx.userId },
    }
  }

  async canCreate(data: Prisma.SavedUserConfigurationValueUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
