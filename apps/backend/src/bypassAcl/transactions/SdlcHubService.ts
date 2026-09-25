import { transaction } from '../base';
import type { SdlcActor } from '@/sdlc/types';
import { AppError } from '@/middleware/errorHandler';
import { sdlcChannelCanvasParticipant } from '@/sdlc/sdlcCanvasAccess';
import { ensureHubKnowledgeFolder, placeHubItem, ensureHubWikiFolder, ensureRepositoryWikiFolder } from '@/sdlc/hubFolders';
import { ensureLink } from '@/sdlc/entityLinkService';
import { SdlcHubService, SDLC_FOLDERS, channelRepository } from '@/sdlc/SdlcHubService';
import type { SdlcSourceReference } from '@/sdlc/sdlcSourceReferences';
import { type ParsedRepository, sdlcVcs } from '@/sdlc/vcs';
import { CanvasVisibility, SDLC_CONTAINMENT_RELATION, SDLC_TRACK_FLAT_RELATION, SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE, stringifySdlcSourceReferences, SDLC_ARTIFACT_REPOSITORY_RELATION, SDLC_TRACK_MEMBERSHIP_RELATION, ChannelAddUserPolicy, ChannelRole, ChannelScopeType, ChannelType, ChannelVisibility, normalizeChannelName, validateChannelName, SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { BlockNoteBlock } from '@/types/blockNoteTypes';
import { randomUUID } from 'crypto';
import type { TransactionClient } from '@/sdlc/SdlcHubService';


export function createRepositoryTx(self: SdlcHubService, input: { projectId: string; url: string; name?: string | undefined; baseBranch?: string | undefined; credentialId?: string | undefined; }, actor: SdlcActor, parsedRepository: ParsedRepository, canonicalUrl: string, name: string) {
  return transaction(['ChannelParticipant', 'Project', 'Repo', 'ResourceAccess', 'User'], 'createRepository: project check, duplicate check and repo create must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    await self.requireProjectBoardAccess(tx, actor, project.id);
    const vcsCredentialId = await self.chooseCredential(actor, parsedRepository, input.credentialId);
    const baseBranch =
      input.baseBranch ??
      (await sdlcVcs.defaultBranch(actor.workspaceId, parsedRepository, vcsCredentialId)) ??
      'main';

    const duplicate = await tx.repo.findFirst({
      where: { workspaceId: actor.workspaceId, canonicalUrl },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError('This repository is already registered in this workspace', 409);
    }

    const repo = await tx.repo.create({
      data: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        name,
        url: input.url.trim(),
        canonicalUrl,
        baseBranch: [baseBranch],
        // Legacy required column. SDLC branch naming comes from approved
        // repository conventions, never this compatibility placeholder.
        prefix: '',
        createdBy: actor.userId,
        projectId: project.id,
        vcsCredentialId,
      },
    });

    return {
      id: repo.id,
      name: repo.name,
      url: repo.url,
      canonicalUrl,
      projectId: project.id,
    };
  });
}
export function createChannelTx(self: SdlcHubService, input: { name: string; projectId: string; repoIds: string[]; }, actor: SdlcActor) {
  return transaction(['Board', 'CanvasFolder', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Project', 'Repo', 'ResourceAccess', 'SdlcEntityLink', 'SdlcFolder', 'User'], 'createChannel: project check, channel plus board-mapping/folder rows and repo links must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    await self.requireProjectBoardAccess(tx, actor, project.id);

    const channelId = await createSdlcChannel(tx, actor, {
      projectId: project.id,
      name: input.name,
    });

    const repoIds = await attachRepositoriesToChannel(tx, actor, channelId, input.repoIds);

    return { id: channelId, name: input.name.trim(), projectId: project.id, repoIds };
  });
}
export function addChannelRepositoriesTx(self: SdlcHubService, actor: SdlcActor, channelId: string, repoIds: string[]) {
  return transaction(['Channel', 'Repo', 'SdlcEntityLink', 'SdlcFolder'], 'addChannelRepositories: channel repo links and hub/wiki folder rows must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => ({
    repoIds: await attachRepositoriesToChannel(tx, actor, channelId, repoIds),
  }));
}
export function createArtifactFromClawTx(self: SdlcHubService, actor: SdlcActor, input: { title: string; folderId: string; markdown: string; channelId?: string | undefined; trackId?: string | undefined; repoId?: string | undefined; sourceReferences?: { path: string; symbol?: string | undefined; startLine?: number | undefined; endLine?: number | undefined; }[] | undefined; repoIds?: string[] | undefined; relatedCanvasIds?: string[] | undefined; }, content: BlockNoteBlock[], channelId: string, folder: any, projectId: any, repo: any, hubKnowledge: boolean, artifactGenerationCommit: string | undefined, artifactSourceReferences: SdlcSourceReference[], repoIds: string[]) {
  return transaction(['Canvas', 'CanvasParticipant', 'SdlcArtifact', 'SdlcEntityLink', 'SdlcFolder'], 'createArtifactFromClaw: canvas, artifact, track/repo links and hub placement must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const viewAccessId = randomUUID();
    const canvas = await tx.canvas.create({
      data: {
        workspaceId: actor.workspaceId,
        title: input.title,
        content: content as unknown as Prisma.InputJsonValue,
        channelId,
        folderId: folder.id,
        projectId,
        createdBy: actor.userId,
        lastEditedBy: actor.userId,
        lastEditedAt: new Date(),
        viewAccessId,
        visibility: CanvasVisibility.PRIVATE,
        isCollaborative: true,
        metadata: {} as Prisma.InputJsonValue,
        participants: {
          create: sdlcChannelCanvasParticipant(actor.workspaceId, channelId),
        },
      },
    });
    if (input.trackId) {
      await tx.sdlcEntityLink.create({
        data: {
          workspaceId: actor.workspaceId,
          channelId,
          sourceType: 'TRACK',
          sourceId: input.trackId,
          targetType: 'CANVAS',
          targetId: canvas.id,
          relationType: SDLC_CONTAINMENT_RELATION,
          createdBy: actor.userId,
        },
      });
      await tx.sdlcEntityLink.create({
        data: {
          workspaceId: actor.workspaceId,
          channelId,
          sourceType: 'TRACK',
          sourceId: input.trackId,
          targetType: 'CANVAS',
          targetId: canvas.id,
          relationType: SDLC_TRACK_FLAT_RELATION,
          createdBy: actor.userId,
        },
      });
    }
    await tx.sdlcArtifact.create({
      data: {
        workspaceId: actor.workspaceId,
        ...(repo ? { repoId: repo.id } : {}),
        artifactId: canvas.id,
        artifactType: hubKnowledge ? SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE : 'DEFAULT',
        artifactStatus: 'ACTIVE',
        ...(artifactGenerationCommit ? { generationCommit: artifactGenerationCommit } : {}),
        sourceReferences: stringifySdlcSourceReferences(artifactSourceReferences),
        createdBy: actor.userId,
      },
    });

    if (hubKnowledge) {
      const actorRef = { workspaceId: actor.workspaceId, userId: actor.userId };
      const knowledgeFolderId = await ensureHubKnowledgeFolder(tx, actorRef, channelId);
      await placeHubItem(tx, actorRef, {
        channelId,
        scopeFolderId: knowledgeFolderId,
        parentId: knowledgeFolderId,
        targetType: 'CANVAS',
        targetId: canvas.id,
      });
    }

    for (const artifactRepoId of repoIds) {
      await ensureLink(
        tx,
        {
          channelId,
          sourceType: 'CANVAS',
          sourceId: canvas.id,
          targetType: 'REPOSITORY',
          targetId: artifactRepoId,
          relationType: SDLC_ARTIFACT_REPOSITORY_RELATION,
        },
        { workspaceId: actor.workspaceId, userId: actor.userId }
      );
    }

    const relatedIds = Array.from(
      new Set((input.relatedCanvasIds ?? []).filter(id => id !== canvas.id)),
    );
    if (relatedIds.length > 0) {
      const validRelated = await tx.canvas.findMany({
        where: { id: { in: relatedIds }, channelId },
        select: { id: true },
      });
      for (const related of validRelated) {
        await tx.sdlcEntityLink.create({
          data: {
            workspaceId: actor.workspaceId,
            channelId,
            sourceType: 'CANVAS',
            sourceId: related.id,
            targetType: 'CANVAS',
            targetId: canvas.id,
            relationType: 'CONTEXT',
            createdBy: actor.userId,
          },
        });
      }
    }
    return {
      artifact: {
        canvasId: canvas.id,
        viewAccessId,
        url: `/chat/canvas/${canvas.id}`,
      },
      canvasId: canvas.id,
      content,
    };
  });
}
export function updateArtifactFromClawTx(self: SdlcHubService, existing: any, input: { canvasId: string; markdown: string; title?: string | undefined; channelId?: string | undefined; repoId?: string | undefined; sourceReferences?: { path: string; symbol?: string | undefined; startLine?: number | undefined; endLine?: number | undefined; }[] | undefined; }, content: BlockNoteBlock[], actor: SdlcActor, repo: any, generationCommit: string | null, resolved: { markdown: string; sourceReferences: SdlcSourceReference[]; }) {
  return transaction(['Canvas', 'SdlcArtifact'], 'updateArtifactFromClaw: canvas content and artifact source-reference row must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const canvas = await tx.canvas.update({
      where: { id: existing.id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        content: content as unknown as Prisma.InputJsonValue,
        lastEditedBy: actor.userId,
        lastEditedAt: new Date(),
      },
      select: { id: true, viewAccessId: true },
    });
    await tx.sdlcArtifact.upsert({
      where: { artifactId: existing.id },
      create: {
        workspaceId: actor.workspaceId,
        ...(repo ? { repoId: repo.id } : {}),
        artifactId: existing.id,
        artifactType: 'DEFAULT',
        ...(generationCommit ? { generationCommit } : {}),
        sourceReferences: stringifySdlcSourceReferences(resolved.sourceReferences),
        createdBy: actor.userId,
      },
      update: {
        ...(generationCommit ? { generationCommit } : {}),
        sourceReferences: stringifySdlcSourceReferences(resolved.sourceReferences),
      },
    });
    return {
      artifact: {
        canvasId: canvas.id,
        viewAccessId: canvas.viewAccessId ?? undefined,
        url: `/chat/canvas/${canvas.viewAccessId ?? canvas.id}`,
      },
      canvasId: canvas.id,
      content,
    };
  });
}
export function createTrackTx(self: SdlcHubService, actor: SdlcActor, input: { name: string; channelId: string; description?: string | undefined; repoId?: string | undefined; }, channelId: string) {
  return transaction(['SdlcEntityLink', 'SdlcTrack'], 'createTrack: track create and hub membership edge must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const track = await tx.sdlcTrack.create({
      data: {
        workspaceId: actor.workspaceId,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        status: 'ACTIVE',
        createdBy: actor.userId,
      },
      select: { id: true, name: true, description: true, status: true },
    });
    // The track carries no scope column; this edge is what places it in the hub.
    await tx.sdlcEntityLink.create({
      data: {
        workspaceId: actor.workspaceId,
        channelId,
        sourceType: 'CHANNEL',
        sourceId: channelId,
        targetType: 'TRACK',
        targetId: track.id,
        relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
        createdBy: actor.userId,
      },
    });
    return track;
  });
}

  /** The private channel a hub lives in, plus its starting artifact-type folders. */
export async function createSdlcChannel(tx: TransactionClient, actor: SdlcActor, input: { projectId: string; name: string }): Promise<string> {
    const name = normalizeChannelName(input.name.trim());
    const nameError = validateChannelName(name);
    if (nameError) {
      throw new AppError(nameError, 400);
    }
    if (await channelRepository.checkDuplicateName(name, actor.workspaceId)) {
      throw new AppError(`Channel with name "${name}" already exists.`, 409);
    }

    const channelId = randomUUID();
    const now = new Date();

    await tx.channel.create({
      data: {
        id: channelId,
        name,
        description: `Private SDLC workspace for ${name}`,
        type: ChannelType.SDLC,
        scopeType: ChannelScopeType.DEFAULT,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: actor.userId,
        projectId: input.projectId,
        workspaceId: actor.workspaceId,
        participantCount: 1,
        addUserPolicy: ChannelAddUserPolicy.ADMINS_ONLY,
        showTicketsTabTicketsInChat: false,
        metadata: {},
        channelStats: {
          create: {
            workspaceId: actor.workspaceId,
            lastActivityAt: now,
            participantCount: 1,
            addUserPolicy: ChannelAddUserPolicy.ADMINS_ONLY,
          },
        },
        participants: {
          create: {
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            role: ChannelRole.ADMIN,
          },
        },
        participantsStatus: {
          create: {
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            isDeleted: false,
            updatedAt: now,
          },
        },
      },
    });

    // Dual-write: mirror the channel→project board set into ChannelBoardMapping so
    // downstream consumers resolve boards via the mapping, not channel.projectId.
    // SDLC channels always have a project; default = oldest board.
    const boards = await tx.board.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (boards.length > 0) {
      await tx.channelBoardMapping.createMany({
        data: boards.map((board, index) => ({
          id: randomUUID(),
          channelId,
          boardId: board.id,
          workspaceId: actor.workspaceId,
          isDefault: index === 0,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }

    await tx.canvasFolder.createMany({
      data: SDLC_FOLDERS.map((folderName) => ({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        projectId: input.projectId,
        channelId,
        name: folderName,
        createdBy: actor.userId,
      })),
    });

    return channelId;
  }

export async function attachRepositoriesToChannel(tx: TransactionClient, actor: SdlcActor, channelId: string, repoIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(repoIds)];
    if (unique.length === 0) return [];

    const channel = await tx.channel.findFirst({
      where: { id: channelId, workspaceId: actor.workspaceId },
      select: { projectId: true },
    });
    if (!channel?.projectId) {
      throw new AppError('SDLC hub not found', 404);
    }
    const repos = await tx.repo.findMany({
      where: { id: { in: unique }, workspaceId: actor.workspaceId, projectId: { not: null } },
      select: { id: true, name: true },
    });
    if (repos.length !== unique.length) {
      throw new AppError('One or more repositories were not found in this workspace', 404);
    }

    await tx.sdlcEntityLink.createMany({
      data: repos.map((repo) => ({
        workspaceId: actor.workspaceId,
        channelId,
        sourceType: 'CHANNEL',
        sourceId: channelId,
        targetType: 'REPOSITORY',
        targetId: repo.id,
        relationType: SDLC_MEMBERSHIP_RELATION,
        createdBy: actor.userId,
      })),
      skipDuplicates: true,
    });
    await ensureHubKnowledgeFolder(tx, actor, channelId);
    await ensureHubWikiFolder(tx, actor, channelId);
    for (const repo of repos) {
      await ensureRepositoryWikiFolder(tx, actor, channelId, repo);
    }

    return repos.map((repo) => repo.id);
  }
