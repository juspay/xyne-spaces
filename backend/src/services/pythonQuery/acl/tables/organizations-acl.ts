import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class OrganizationsACL extends BaseQueryACL<Prisma.OrganizationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrganizationWhereInput | null> {
    // Get org IDs where user is a member
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId: this.ctx.userId },
      select: { orgId: true },
    })

    const memberOrgIds = memberships.map((m) => m.orgId)

    return {
      OR: [
        { createdBy: this.ctx.userId },
        { orgId: { in: memberOrgIds } },
      ],
    }
  }
}
