import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReposACL extends BaseQueryACL<Prisma.RepoWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RepoWhereInput | null> {
    // No restriction - all users can see all repos
    return null
  }
}
