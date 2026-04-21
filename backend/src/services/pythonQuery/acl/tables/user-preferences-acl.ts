import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * UserPreferences ACL for Python Query Service
 * Controls read access to user preferences
 * All users in the same workspace can see each other's preferences
 */
export class UserPreferencesACL extends BaseQueryACL<Prisma.UserPreferenceWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserPreferenceWhereInput> {
    // Get all userIds in this workspace
    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })

    const userIds = workspaceUsers.map(u => u.id)

    // Return preferences for users in this workspace
    return {
      userId: { in: userIds },
    }
  }
}
