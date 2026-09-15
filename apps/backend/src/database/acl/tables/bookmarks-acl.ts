import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BookmarksACL extends BaseQueryACL<
  Prisma.BookmarkWhereInput,
  Prisma.BookmarkUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BookmarkWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.BookmarkWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(data: Prisma.BookmarkUncheckedCreateInput): Promise<boolean> {
    return data.userId === this.ctx.userId
  }
}
