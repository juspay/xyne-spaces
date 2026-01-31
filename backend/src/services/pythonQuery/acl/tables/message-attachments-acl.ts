import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MessageAttachmentsACL extends BaseQueryACL<Prisma.MessageAttachmentWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageAttachmentWhereInput | null> {
    // No restriction - open access (matches Zero's behavior)
    return null
  }
}
