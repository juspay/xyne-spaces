import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class OrganizationsACL extends BaseQueryACL<Prisma.OrganizationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.OrganizationWhereInput | null> {
    return {
      OR: [
        { createdBy: this.ctx.userId },
        { members: { some: { userId: this.ctx.userId } } },
      ],
    }
  }
}
