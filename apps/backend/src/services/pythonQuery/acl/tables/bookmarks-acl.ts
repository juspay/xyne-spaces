import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BookmarksACL extends BaseQueryACL<Prisma.BookmarkWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BookmarkWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
