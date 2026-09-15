import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleConversationIds, isGuestContext } from './channel-access-helper'

export class MessageAttachmentsACL extends BaseQueryACL<
  Prisma.MessageAttachmentWhereInput,
  Prisma.MessageAttachmentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageAttachmentWhereInput> {
    if (isGuestContext(this.ctx)) {
      const conversationIds = await getAccessibleConversationIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        conversationId: { in: conversationIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.MessageAttachmentWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.MessageAttachmentUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
