import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BoardComplexityScoresACL extends BaseQueryACL<Prisma.BoardComplexityScoreWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardComplexityScoreWhereInput | null> {
    return null
  }
}
