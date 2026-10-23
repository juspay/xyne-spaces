import { Prisma, PrismaClient } from '@prisma/client';
import { BaseQueryACL, ACLContext } from '../base-acl';
import { getAccessibleChannelIds } from './channel-access-helper';

type ChannelScoped = { workspaceId: string; channelId: string };

/**
 * Agent proactivity's records: decisions and the XOR calls behind them. Readable by the
 * members of their channel, like its messages. The pipeline writes as the asker, who is
 * a member. The channels are read once per query, as a batch of question rows checks
 * every row.
 */
class ChannelMembersACL<Where, Create extends ChannelScoped> extends BaseQueryACL<Where, Create> {
  private channelIds: Promise<string[]> | null = null;

  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  private accessible(): Promise<string[]> {
    this.channelIds ??= getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx);
    return this.channelIds;
  }

  async getWhereClause(): Promise<Where> {
    return {
      workspaceId: this.ctx.workspaceId,
      channelId: { in: await this.accessible() },
    } as Where;
  }

  async getMutateWhere(): Promise<Where> {
    return this.getWhereClause();
  }

  async canCreate(data: Create): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false;
    return (await this.accessible()).includes(data.channelId);
  }
}

export class AgentProactivityDecisionsACL extends ChannelMembersACL<
  Prisma.AgentProactivityDecisionWhereInput,
  Prisma.AgentProactivityDecisionUncheckedCreateInput
> {}

export class AgentProactivityXorCallsACL extends ChannelMembersACL<
  Prisma.AgentProactivityXorCallWhereInput,
  Prisma.AgentProactivityXorCallUncheckedCreateInput
> {}

export class AgentProactivityXorQuestionsACL extends ChannelMembersACL<
  Prisma.AgentProactivityXorQuestionWhereInput,
  Prisma.AgentProactivityXorQuestionUncheckedCreateInput
> {}
