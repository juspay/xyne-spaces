import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getAccessibleConversationIds,
  getConnectAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class MessageAttachmentsACL extends BaseQueryACL<
  Prisma.MessageAttachmentWhereInput,
  Prisma.MessageAttachmentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageAttachmentWhereInput> {
    // Slack-Connect: attachments on connect channels the caller is an active member of, across orgs.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectBranch: Prisma.MessageAttachmentWhereInput = {
      conversation: { channelId: { in: connectChannelIds } },
    }

    if (isGuestContext(this.ctx)) {
      const conversationIds = await getAccessibleConversationIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          {
            workspaceId: this.ctx.workspaceId ?? '',
            conversationId: { in: conversationIds },
          },
          connectBranch,
        ],
      }
    }

    return {
      OR: [{ workspaceId: this.ctx.workspaceId }, connectBranch],
    }
  }

  async getMutateWhere(): Promise<Prisma.MessageAttachmentWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.MessageAttachmentUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
