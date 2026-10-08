import { transaction } from '../base';
import type { SdlcActor } from '@/sdlc/types';
import { AppError } from '@/middleware/errorHandler';
import { sdlcChannelCanvasParticipant } from '@/sdlc/sdlcCanvasAccess';
import { newConnectId, createConnectGroupForEntity, ConnectEntityType } from '@/database/connectGroup';
import { ensureHubKnowledgeFolder, placeHubItem, ensureHubWikiFolder, ensureRepositoryWikiFolder } from '@/sdlc/hubFolders';
import { ensureLink, refileFolderEdges } from '@/sdlc/entityLinkService';
import { SdlcHubService, SDLC_FOLDERS, channelRepository, linkRelatedCanvases } from '@/sdlc/SdlcHubService';
import { type ParsedRepository, sdlcVcs } from '@/sdlc/vcs';
import { CanvasVisibility, isSdlcTreeItemType, SDLC_CONTAINMENT_RELATION, SDLC_TRACK_FLAT_RELATION, SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE, SDLC_ARTIFACT_REPOSITORY_RELATION, SDLC_TRACK_MEMBERSHIP_RELATION, ChannelAddUserPolicy, ChannelRole, ChannelScopeType, ChannelType, ChannelVisibility, normalizeChannelName, validateChannelName, SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
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
export function createArtifactFromClawTx(self: SdlcHubService, actor: SdlcActor, input: { title: string; folderId: string; markdown: string; channelId?: string | undefined; trackId?: string | undefined; trackFolderId?: string | undefined; repoId?: string | undefined; repoIds?: string[] | undefined; relatedCanvasIds?: string[] | undefined; }, content: BlockNoteBlock[], channelId: string, folder: { id: string; name: string }, projectId: string, repo: { id: string } | null, hubKnowledge: boolean, trackFolderId: string | undefined, repoIds: string[]) {
  return transaction(['Canvas', 'CanvasParticipant', 'SdlcArtifact', 'SdlcEntityLink', 'SdlcFolder', 'ConnectGroup'], 'createArtifactFromClaw: canvas, artifact, track/repo links and hub placement must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const viewAccessId = randomUUID();
    // Slack Connect: a canvas is a shareable entity → its own connectId + a private connect_group row.
    const connectId = newConnectId();
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
        connectId,
        metadata: {} as Prisma.InputJsonValue,
        participants: {
          create: sdlcChannelCanvasParticipant(actor.workspaceId, channelId, connectId),
        },
      },
    });
    await createConnectGroupForEntity(tx, {
      entityType: ConnectEntityType.CANVAS,
      entityId: canvas.id,
      hostWorkspaceId: actor.workspaceId,
      connectId,
    });
    if (input.trackId) {
      await tx.sdlcEntityLink.create({
        data: {
          workspaceId: actor.workspaceId,
          channelId,
          sourceType: trackFolderId ? 'FOLDER' : 'TRACK',
          sourceId: trackFolderId ?? input.trackId,
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
      await refileFolderEdges(
        tx,
        {
          channelId,
          item: { type: 'CANVAS', id: canvas.id },
          parent: trackFolderId
            ? { type: 'FOLDER', id: trackFolderId }
            : { type: 'TRACK', id: input.trackId },
        },
        { workspaceId: actor.workspaceId, userId: actor.userId }
      );
    }
    await tx.sdlcArtifact.create({
      data: {
        workspaceId: actor.workspaceId,
        ...(repo ? { repoId: repo.id } : {}),
        artifactId: canvas.id,
        artifactType: hubKnowledge ? SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE : 'DEFAULT',
        artifactStatus: 'ACTIVE',
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

    await linkRelatedCanvases(tx, actor, channelId, canvas.id, input.relatedCanvasIds);
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

export function updateArtifactTitleOrLinksTx(self: SdlcHubService, actor: SdlcActor, channelId: string, existing: { id: string; viewAccessId: string | null; title: string }, input: { title?: string | undefined; relatedCanvasIds?: string[] | undefined }) {
  return transaction(['Canvas', 'SdlcEntityLink'], 'updateArtifactFromClaw (title/links only): canvas title update and related-canvas links must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await linkRelatedCanvases(tx, actor, channelId, existing.id, input.relatedCanvasIds);
    if (!input.title) return existing;
    return tx.canvas.update({
      where: { id: existing.id },
      data: { title: input.title, lastEditedBy: actor.userId, lastEditedAt: new Date() },
      select: { id: true, viewAccessId: true },
    });
  });
}

export function writeArtifactContentTx(self: SdlcHubService, actor: SdlcActor, channelId: string, canvasId: string, content: BlockNoteBlock[], extra: { title?: string | undefined; repoId?: string | undefined; relatedCanvasIds?: string[] | undefined }) {
  return transaction(['Canvas', 'SdlcArtifact', 'SdlcEntityLink'], 'writeArtifactContent: canvas content, artifact upsert and related-canvas links must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const canvas = await tx.canvas.update({
      where: { id: canvasId },
      data: {
        ...(extra.title ? { title: extra.title } : {}),
        content: content as unknown as Prisma.InputJsonValue,
        lastEditedBy: actor.userId,
        lastEditedAt: new Date(),
      },
      select: { id: true, viewAccessId: true },
    });
    await tx.sdlcArtifact.upsert({
      where: { artifactId: canvasId },
      create: {
        workspaceId: actor.workspaceId,
        ...(extra.repoId ? { repoId: extra.repoId } : {}),
        artifactId: canvasId,
        artifactType: 'DEFAULT',
        createdBy: actor.userId,
      },
      update: {},
    });
    await linkRelatedCanvases(tx, actor, channelId, canvasId, extra.relatedCanvasIds);
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
export function moveArtifactFromClawTx(self: SdlcHubService, actor: SdlcActor, channelId: string, input: { canvasId: string; parentId: string }, toRoot: boolean) {
  return transaction(['SdlcEntityLink'], 'moveArtifactFromClaw: the old containment edge, the new one and the folder edges that follow must commit atomically; tx is not ACL-wrapped', self.prisma, async tx => {
    await tx.sdlcEntityLink.deleteMany({
      where: {
        channelId,
        relationType: SDLC_CONTAINMENT_RELATION,
        targetType: 'CANVAS',
        targetId: input.canvasId,
      },
    });
    await ensureLink(
      tx,
      {
        channelId,
        sourceType: toRoot ? 'TRACK' : 'FOLDER',
        sourceId: input.parentId,
        targetType: 'CANVAS',
        targetId: input.canvasId,
        relationType: SDLC_CONTAINMENT_RELATION,
      },
      { workspaceId: actor.workspaceId, userId: actor.userId }
    );
    await refileFolderEdges(
      tx,
      {
        channelId,
        item: { type: 'CANVAS', id: input.canvasId },
        parent: { type: toRoot ? 'TRACK' : 'FOLDER', id: input.parentId },
      },
      { workspaceId: actor.workspaceId, userId: actor.userId }
    );
  });
}

/**
 * Removes a content link. When it filed an item into a folder, the item leaves the
 * folders it was under, taking everything beneath it along.
 */
export function unlinkContextTx(self: SdlcHubService, actor: SdlcActor, channelId: string, link: { id: string; relationType: string; targetType: string; targetId: string }): Promise<number> {
  return transaction(['SdlcEntityLink'], 'unlinkContext: the link and the folder edges that follow an unfiled item must commit atomically; tx is not ACL-wrapped', self.prisma, async tx => {
    const removed = await tx.sdlcEntityLink.deleteMany({
      where: { id: link.id, channelId, workspaceId: actor.workspaceId },
    });
    if (removed.count > 0 && link.relationType === SDLC_CONTAINMENT_RELATION && isSdlcTreeItemType(link.targetType)) {
      await refileFolderEdges(
        tx,
        { channelId, item: { type: link.targetType, id: link.targetId }, parent: null },
        { workspaceId: actor.workspaceId, userId: actor.userId }
      );
    }
    return removed.count;
  });
}

export function createTrackFolderFromClawTx(self: SdlcHubService, actor: SdlcActor, input: { channelId: string; trackId: string; name: string; parentTrackFolderId?: string | undefined }) {
  const actorRef = { workspaceId: actor.workspaceId, userId: actor.userId };
  return transaction(['SdlcEntityLink', 'SdlcFolder'], 'createTrackFolderFromClaw: folder create, its containment and track edges and its folder edges must commit atomically; tx is not ACL-wrapped', self.prisma, async tx => {
    const folder = await tx.sdlcFolder.create({
      data: { workspaceId: actor.workspaceId, name: input.name, createdBy: actor.userId },
      select: { id: true, name: true },
    });
    await ensureLink(
      tx,
      {
        channelId: input.channelId,
        sourceType: input.parentTrackFolderId ? 'FOLDER' : 'TRACK',
        sourceId: input.parentTrackFolderId ?? input.trackId,
        targetType: 'FOLDER',
        targetId: folder.id,
        relationType: SDLC_CONTAINMENT_RELATION,
      },
      actorRef
    );
    await ensureLink(
      tx,
      {
        channelId: input.channelId,
        sourceType: 'TRACK',
        sourceId: input.trackId,
        targetType: 'FOLDER',
        targetId: folder.id,
        relationType: SDLC_TRACK_FLAT_RELATION,
      },
      actorRef
    );
    await refileFolderEdges(
      tx,
      {
        channelId: input.channelId,
        item: { type: 'FOLDER', id: folder.id },
        parent: input.parentTrackFolderId
          ? { type: 'FOLDER', id: input.parentTrackFolderId }
          : { type: 'TRACK', id: input.trackId },
      },
      actorRef
    );
    return { ...folder, trackId: input.trackId, parentId: input.parentTrackFolderId ?? input.trackId };
  });
}

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
    // Slack Connect: the channel is a shareable entity → its own connectId + a private connect_group row.
    const connectId = newConnectId();

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
        connectId,
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
    await createConnectGroupForEntity(tx, {
      entityType: ConnectEntityType.CHANNEL,
      entityId: channelId,
      hostWorkspaceId: actor.workspaceId,
      connectId,
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
        data: boards.map((board: { id: string }, index: number) => ({
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
      data: SDLC_FOLDERS.map((folderName: string) => ({
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
      data: repos.map((repo: { id: string; name: string }) => ({
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

    return repos.map((repo: { id: string; name: string }) => repo.id);
  }
