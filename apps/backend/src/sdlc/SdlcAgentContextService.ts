import { ChannelType, SDLC_AGENT_SLUG, type SdlcAgentContext } from '@xyne/shared';
import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { findSdlcMembershipForActor, repoIdsForChannel } from './sdlcChannelMembership';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import type { SdlcActor } from './types';
import { sdlcVcs } from './vcs';
import { issueSdlcInteractiveGrant } from './vcs/sdlcInteractiveGrant';

export type { SdlcAgentContext };

export interface SdlcAgentContextInput {
  channelId?: string;
  conversationId: string;
  generationCommit?: string;
}

function grantSecret(): string {
  return process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || '';
}

export class SdlcAgentContextService {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async build(
    actor: SdlcActor,
    repoId: string,
    input: SdlcAgentContextInput
  ): Promise<SdlcAgentContext> {
    const [repo, membership] = await Promise.all([
      this.prisma.repo.findFirst({
        where: { id: repoId, workspaceId: actor.workspaceId, projectId: { not: null } },
        select: {
          id: true,
          name: true,
          url: true,
          canonicalUrl: true,
          baseBranch: true,
          projectId: true,
        },
      }),
      findSdlcMembershipForActor(this.prisma, {
        workspaceId: actor.workspaceId,
        repoId,
        userId: actor.userId,
        ...(input.channelId ? { channelId: input.channelId } : {}),
      }),
    ]);
    if (!repo?.projectId) throw new AppError('SDLC repository not found', 404);
    if (!membership) {
      throw new AppError(
        input.channelId
          ? 'This repository is not part of that SDLC Hub'
          : 'You are not a member of this repository',
        403
      );
    }
    const parsed = sdlcVcs.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    // The hub's project: the repository may be registered in another one.
    const hub = await this.prisma.channel.findFirst({
      where: { id: membership.channelId, workspaceId: actor.workspaceId },
      select: { projectId: true },
    });
    return {
      version: 1,
      operation: 'interactive',
      workspaceId: actor.workspaceId,
      projectId: hub?.projectId ?? repo.projectId,
      channelId: membership.channelId,
      actorUserId: actor.userId,
      repository: {
        id: repo.id,
        name: repo.name,
        url: parsed.cloneUrl,
        baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      },
      execution: { conversationId: input.conversationId },
      interactiveGrant: issueSdlcInteractiveGrant(
        {
          agentSlug: SDLC_AGENT_SLUG,
          workspaceId: actor.workspaceId,
          repoId: repo.id,
          actorUserId: actor.userId,
          conversationId: input.conversationId,
        },
        grantSecret()
      ),
      generationCommit: input.generationCommit ?? null,
    };
  }

  /** No repository is pinned: the agent picks one with sdlc-repository-access when it needs code. */
  async buildForHub(
    actor: SdlcActor,
    channelId: string,
    input: SdlcAgentContextInput
  ): Promise<SdlcAgentContext> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId: actor.workspaceId, type: ChannelType.SDLC },
      select: {
        projectId: true,
        participants: { where: { userId: actor.userId }, select: { role: true }, take: 1 },
      },
    });
    if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
    if (!channel.participants[0]) throw new AppError('You are not a member of this SDLC hub', 403);

    const repoIds = await repoIdsForChannel(this.prisma, channelId);

    return {
      version: 1,
      operation: 'interactive',
      workspaceId: actor.workspaceId,
      projectId: channel.projectId,
      channelId,
      actorUserId: actor.userId,
      execution: { conversationId: input.conversationId },
      interactiveGrant: issueSdlcInteractiveGrant(
        {
          agentSlug: SDLC_AGENT_SLUG,
          workspaceId: actor.workspaceId,
          repoIds,
          actorUserId: actor.userId,
          conversationId: input.conversationId,
        },
        grantSecret()
      ),
      generationCommit: input.generationCommit ?? null,
    };
  }
}

export const sdlcAgentContext = new SdlcAgentContextService();
