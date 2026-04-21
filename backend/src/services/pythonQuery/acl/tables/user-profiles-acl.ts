import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * UserProfiles ACL for Python Query Service
 * Controls read access to user profiles
 * All users in the same workspace can see each other's profiles
 */
export class UserProfilesACL extends BaseQueryACL<Prisma.UserProfileWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserProfileWhereInput> {
    // Get all userIds in this workspace
    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })

    const userIds = workspaceUsers.map(u => u.id)

    // Return profiles for users in this workspace
    return {
      userId: { in: userIds },
    }
  }
}
