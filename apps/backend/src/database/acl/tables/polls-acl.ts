import type { Prisma, PrismaClient } from '@prisma/client';
import { BaseQueryACL, type ACLContext } from '../base-acl';
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper';

async function channelWhere(
  ctx: ACLContext,
  prisma: PrismaClient
): Promise<Prisma.ChannelWhereInput> {
  if (isGuestContext(ctx)) {
    const channelIds = await getAccessibleChannelIds(prisma, ctx.userId, ctx);
    return { workspaceId: ctx.workspaceId, id: { in: channelIds } };
  }

  return {
    workspaceId: ctx.workspaceId,
    OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: ctx.userId } } }],
  };
}

function pollResultVisibilityWhere(userId: string): Prisma.PollWhereInput {
  return {
    OR: [
      { createdBy: userId },
      { resultVisibility: 'EVERYONE' },
      { resultVisibility: 'AFTER_CLOSE', closedAt: { not: null } },
      {
        resultVisibility: 'ADMIN_ONLY',
        message: {
          conversation: {
            channel: {
              OR: [{ createdBy: userId }, { participants: { some: { userId, role: 'ADMIN' } } }],
            },
          },
        },
      },
    ],
  };
}

export class PollsACL extends BaseQueryACL<Prisma.PollWhereInput> {
  async getWhereClause(): Promise<Prisma.PollWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      message: {
        conversation: { channel: await channelWhere(this.ctx, this.prisma) },
      },
    };
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
    };
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
    };
  }
}

export class PollVotesACL extends BaseQueryACL<Prisma.PollVoteWhereInput> {
  async getWhereClause(): Promise<Prisma.PollVoteWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      AND: [
        {
          poll: {
            message: {
              conversation: { channel: await channelWhere(this.ctx, this.prisma) },
            },
          },
        },
        {
          OR: [
            { userId: this.ctx.userId },
            { poll: { createdBy: this.ctx.userId, isAnonymous: false } },
          ],
        },
      ],
    };
  }
}

export class PollQuestionResultsACL extends BaseQueryACL<Prisma.PollQuestionResultWhereInput> {
  async getWhereClause(): Promise<Prisma.PollQuestionResultWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: {
        AND: [
          { message: { conversation: { channel: await channelWhere(this.ctx, this.prisma) } } },
          pollResultVisibilityWhere(this.ctx.userId),
        ],
      },
    };
  }
}

export class PollJobsACL extends BaseQueryACL<Prisma.PollJobWhereInput> {
  async getWhereClause(): Promise<Prisma.PollJobWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      poll: { createdBy: this.ctx.userId },
    };
  }
}

/** Delivery bookkeeping is service-only; request principals cannot inspect or mutate it. */
export class PollReminderDeliveriesACL extends BaseQueryACL<
  Prisma.PollReminderDeliveryWhereInput,
  Prisma.PollReminderDeliveryCreateInput
> {
  async getWhereClause(): Promise<Prisma.PollReminderDeliveryWhereInput> {
    return { id: { in: [] } };
  }

  async getMutateWhere(): Promise<Prisma.PollReminderDeliveryWhereInput> {
    return { id: { in: [] } };
  }

  async canCreate(): Promise<boolean> {
    return false;
  }
}
