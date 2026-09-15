import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Controls read access to user preferences.
 * Preferences are per-user private (custom instructions, notification keywords and
 * levels), so reads are scoped to the owner rather than the workspace.
 */
export class UserPreferencesACL extends BaseQueryACL<
  Prisma.UserPreferenceWhereInput,
  Prisma.UserPreferenceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserPreferenceWhereInput> {
    // Owner-scoped, matching the mutate rule below and the sync-layer ACL. Loading every
    // user in the workspace to build an id list also made this the most expensive read on
    // the table.
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.UserPreferenceWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(data: Prisma.UserPreferenceUncheckedCreateInput): Promise<boolean> {
    return data.userId === this.ctx.userId
  }
}
