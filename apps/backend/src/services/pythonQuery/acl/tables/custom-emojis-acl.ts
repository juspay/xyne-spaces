import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CustomEmojisACL extends BaseQueryACL<Prisma.CustomEmojiWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — custom emojis are shared reference data.
  async getWhereClause(): Promise<Prisma.CustomEmojiWhereInput | null> {
    return null
  }
}
