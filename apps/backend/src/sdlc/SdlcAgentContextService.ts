import { ChannelType, type SdlcAgentContext, type SdlcLinkedItem } from '@xyne/shared';
import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { resolveInheritedOwner } from './entityLinkService';
import { findSdlcMembershipForActor } from './sdlcChannelMembership';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import type { SdlcActor } from './types';
import { sdlcVcs } from './vcs';

export type { SdlcAgentContext };

export interface SdlcAgentContextInput {
  channelId?: string;
  conversationId: string;
  generationCommit?: string;
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
      execution: {
        conversationId: input.conversationId,
        linked: await this.linkedItem(membership.channelId, input.conversationId),
      },
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
        visibility: true,
        participants: { where: { userId: actor.userId }, select: { role: true }, take: 1 },
      },
    });
    if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
    // A public hub is readable by the whole workspace; SDLC writes still require membership.
    if (channel.visibility !== 'PUBLIC' && !channel.participants[0]) {
      throw new AppError('You are not a member of this SDLC hub', 403);
    }

    return {
      workspaceId: actor.workspaceId,
      projectId: channel.projectId,
      channelId,
      actorUserId: actor.userId,
      execution: {
        conversationId: input.conversationId,
        linked: await this.linkedItem(channelId, input.conversationId),
      },
      generationCommit: input.generationCommit ?? null,
    };
  }

  /** A conversation is the discussion of at most one hub item; the agent fetches more with the SDLC tools. */
  // Scoped to the hub: a conversation id from another hub or workspace resolves to nothing.
  private async linkedItem(channelId: string, conversationId: string): Promise<SdlcLinkedItem | null> {
    const owner = await resolveInheritedOwner(this.prisma, conversationId, channelId);
    if (!owner) {
      const ticket = await this.prisma.ticket.findFirst({
        where: { conversationId, channelId },
        select: { id: true, title: true },
      });
      return ticket
        ? { section: 'TICKET', id: ticket.id, name: ticket.title, relation: 'CONVERSATION' }
        : null;
    }
    return {
      section: owner.sourceType,
      id: owner.sourceId,
      name: await this.ownerName(owner.sourceType, owner.sourceId),
      relation: 'DISCUSSION',
    };
  }

  private async ownerName(type: string, id: string): Promise<string> {
    switch (type) {
      case 'CANVAS':
        return (await this.prisma.canvas.findUnique({ where: { id }, select: { title: true } }))?.title ?? '';
      case 'TRACK':
        return (await this.prisma.sdlcTrack.findUnique({ where: { id }, select: { name: true } }))?.name ?? '';
      case 'FOLDER':
        return (await this.prisma.sdlcFolder.findUnique({ where: { id }, select: { name: true } }))?.name ?? '';
      case 'LINK':
        return (await this.prisma.link.findUnique({ where: { id }, select: { title: true } }))?.title ?? '';
      case 'ATTACHMENT':
        return (
          (await this.prisma.messageAttachment.findUnique({ where: { id }, select: { originalFilename: true } }))
            ?.originalFilename ?? ''
        );
      default:
        return '';
    }
  }
}

export const sdlcAgentContext = new SdlcAgentContextService();
