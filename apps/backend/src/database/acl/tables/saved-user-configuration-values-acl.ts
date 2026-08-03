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

    return {
      // Hard workspace boundary: the row carries its own denormalized workspaceId.
      workspaceId: this.ctx.workspaceId,
      config: {
        workspaceId: this.ctx.workspaceId,
        // Within the workspace: own configs, plus PUBLIC (shared) configs.
        OR: [{ userId: this.ctx.userId }, { visibility: 'PUBLIC' }],
      },
    }
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
