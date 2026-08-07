import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CustomEmojisACL extends BaseQueryACL<
  Prisma.CustomEmojiWhereInput,
  Prisma.CustomEmojiUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // No table-specific read rule; the extension applies the workspace default.
  async getWhereClause(): Promise<Prisma.CustomEmojiWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.CustomEmojiWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.CustomEmojiUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
