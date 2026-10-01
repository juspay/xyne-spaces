import type { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, type ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

async function channelWhere(
  ctx: ACLContext,
  prisma: PrismaClient,
): Promise<Prisma.ChannelWhereInput> {
  if (isGuestContext(ctx)) {
    const channelIds = await getAccessibleChannelIds(prisma, ctx.userId, ctx)
    return { workspaceId: ctx.workspaceId, id: { in: channelIds } }
  }

  return {
    workspaceId: ctx.workspaceId,
    OR: [
      { visibility: 'PUBLIC' },
      { participants: { some: { userId: ctx.userId } } },
    ],
  }
}

export class PollsACL extends BaseQueryACL<Prisma.PollWhereInput> {
  async getWhereClause(): Promise<Prisma.PollWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      message: {
        conversation: { channel: await channelWhere(this.ctx, this.prisma) },
      },
    }
  }
}

export class PollQuestionsACL extends BaseQueryACL<Prisma.PollQuestionWhereInput> {
  async getWhereClause(): Promise<Prisma.PollQuestionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: {
        message: {
          conversation: { channel: await channelWhere(this.ctx, this.prisma) },
        },
      },
    }
  }
}

export class PollOptionsACL extends BaseQueryACL<Prisma.PollOptionWhereInput> {
  async getWhereClause(): Promise<Prisma.PollOptionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      question: {
        poll: {
          message: {
            conversation: { channel: await channelWhere(this.ctx, this.prisma) },
          },
        },
      },
    }
  }
}

export class PollVotesACL extends BaseQueryACL<Prisma.PollVoteWhereInput> {
  async getWhereClause(): Promise<Prisma.PollVoteWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: {
        message: {
          conversation: { channel: await channelWhere(this.ctx, this.prisma) },
        },
      },
    }
  }
}
