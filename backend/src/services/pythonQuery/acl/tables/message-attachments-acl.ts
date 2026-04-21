import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MessageAttachmentsACL extends BaseQueryACL<Prisma.MessageAttachmentWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageAttachmentWhereInput> {
    // Optimized: message_attachments has direct workspaceId (0 hops instead of 2)
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
