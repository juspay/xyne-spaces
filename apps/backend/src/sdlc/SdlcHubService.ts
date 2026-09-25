import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  SDLC_ARTIFACT_REPOSITORY_RELATION,
  SDLC_CONTAINMENT_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE,
  SDLC_HUB_KNOWLEDGE_FOLDER,
  SDLC_WIKI_FOLDER,
  SDLC_TRACK_FLAT_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  sdlcRepoIds,
  CanvasVisibility,
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  normalizeChannelName,
  validateChannelName,
  type AttachSdlcRepositoryInput,
  type CreateSdlcChannelInput,
  type CreateSdlcClawArtifactInput,
  type CreateSdlcLinkInput,
  type CreateSdlcTrackInput,
  type CreateSdlcClawTrackFolderInput,
  type CreateSdlcClawWikiPageInput,
  type ListSdlcEntityLinksInput,
  type ResolveSdlcRepositoryLinkInput,
  type UpdateSdlcClawArtifactInput,
  type EditSdlcClawArtifactSectionInput,
  type MoveSdlcClawArtifactInput,
  type ArchiveSdlcClawArtifactInput,
} from '@xyne/shared';
import type { SdlcNavTarget } from '@xyne/shared/sdlc';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { syncToYSweet } from '@/utils/ysweetUtils';
import { commitAndSyncCanvasArtifact, readCanvasMarkdown } from './sdlcCanvasSync';
import { mutateMarkdownSection } from './markdownSection';
import { requireSdlcProjectAccess } from './sdlcProjectAccess';
import {
  isRepositoryInChannel,
  isTrackInChannel,
  requireSdlcHubReader,
  trackIdsForChannel,
} from './sdlcChannelMembership';
import { sdlcChannelCanvasParticipant } from './sdlcCanvasAccess';
import { ensureLink, resolveFolderTrackId, resolveItemTrackId } from './entityLinkService';
import { resolveSdlcNavTarget } from './sdlcNavTarget';
import type {
  SdlcActor,
  SdlcArtifact,
  SdlcHub,
  SdlcLink,
  SdlcChannel,
  SdlcRepository,
  SdlcRepositoryRunContext,
} from './types';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import { sdlcAgentContext } from './SdlcAgentContextService';
import { sdlcVcs, type ParsedRepository } from './vcs';
import {
  ensureHubKnowledgeFolder,
  ensureHubWikiFolder,
  ensureRepositoryWikiFolder,
  placeHubItem,
} from './hubFolders';
import { sdlcWikiPageStore } from './wiki/SdlcWikiPageStore';

const SDLC_FOLDERS = [SDLC_HUB_KNOWLEDGE_FOLDER, 'PRDs', 'Tech Docs'] as const;

/** Add-only: an existing CONTEXT link is kept, a canvas outside the hub is skipped. */
async function linkRelatedCanvases(
  tx: Prisma.TransactionClient,
  actor: SdlcActor,
  channelId: string,
  canvasId: string,
  relatedCanvasIds: string[] | undefined
): Promise<void> {
  const ids = [...new Set((relatedCanvasIds ?? []).filter(id => id !== canvasId))];
  if (ids.length === 0) return;
  const related = await tx.canvas.findMany({
    where: { id: { in: ids }, channelId },
    select: { id: true },
  });
  for (const { id } of related) {
    await ensureLink(
      tx,
      {
        channelId,
        sourceType: 'CANVAS',
        sourceId: id,
        targetType: 'CANVAS',
        targetId: canvasId,
        relationType: 'CONTEXT',
      },
      { workspaceId: actor.workspaceId, userId: actor.userId }
    );
  }
}
const channelRepository = new ChannelRepository();
type TransactionClient = Prisma.TransactionClient;

export class SdlcHubService implements SdlcHub {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async resolveRepositoryLink(actor: SdlcActor, input: ResolveSdlcRepositoryLinkInput) {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!project) throw new AppError('Project not found', 404);
    await this.requireProjectBoardAccess(this.prisma, actor, project.id);
    const repository = sdlcVcs.parseRepositoryUrl(input.url);
    const [existing, credentials] = await Promise.all([
      this.prisma.repo.findFirst({
        where: { workspaceId: actor.workspaceId, canonicalUrl: repository.canonicalUrl },
        select: { id: true, name: true, projectId: true },
      }),
      sdlcVcs.credentialsForRepository(actor.workspaceId, repository),
    ]);
    // Refuse before any request: only github.com and hosts a credential serves are ever contacted.
    if (repository.provider !== 'GITHUB' && credentials.length === 0) {
      throw new AppError(
        `No repository credential serves ${repository.host}. Ask a workspace admin to add one.`,
        400
      );
    }
    const defaultBranch =
      (await sdlcVcs.defaultBranch(
        actor.workspaceId,
        repository,
        credentials.length === 1 ? credentials[0]!.id : null
      )) ?? 'main';
    return {
      provider: repository.provider,
      host: repository.host,
      name: repository.name,
      canonicalUrl: repository.canonicalUrl,
      defaultBranch,
      existingRepository: existing,
      credentials,
    };
  }

  async searchProjectRepositories(
    actor: SdlcActor,
    projectId: string,
    scope: { provider: 'GITHUB' | 'BITBUCKET_SERVER'; host: string },
    query: string
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!project) throw new AppError('Project not found', 404);
    await this.requireProjectBoardAccess(this.prisma, actor, project.id);
    const needle = query.trim();
    const limit = 20;
    const [registered, reachable] = await Promise.all([
      this.prisma.repo.findMany({
        where: {
          workspaceId: actor.workspaceId,
          projectId: { not: null },
          canonicalUrl: { startsWith: `https://${scope.host}/`, mode: 'insensitive' },
          OR: [
            { name: { contains: needle, mode: 'insensitive' } },
            { canonicalUrl: { contains: needle, mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: { id: true, name: true, canonicalUrl: true, url: true, projectId: true },
      }),
      // One character matches too much to be useful; empty lists the first few.
      needle.length !== 1
        ? sdlcVcs.searchCredentialRepositories(actor.workspaceId, scope, needle, limit)
        : Promise.resolve([]),
    ]);
    const existing = await this.prisma.repo.findMany({
      where: {
        workspaceId: actor.workspaceId,
        canonicalUrl: { in: reachable.map((item) => item.repository.canonicalUrl) },
      },
      select: { id: true, name: true, canonicalUrl: true, projectId: true },
    });
    const registeredIds = new Set(registered.map((repo) => repo.id));
    return [
      ...registered.map((repo) => ({
        status: repo.projectId === project.id ? ('LINKED' as const) : ('OTHER_PROJECT' as const),
        id: repo.id,
        projectId: repo.projectId,
        name: repo.name,
        canonicalUrl: repo.canonicalUrl || repo.url,
        cloneUrl: null,
        credentials: [],
      })),
      ...reachable.flatMap(({ repository, credentials }) => {
        const match = existing.find((repo) => repo.canonicalUrl === repository.canonicalUrl);
        if (match && registeredIds.has(match.id)) return [];
        return [
          {
            status: match
              ? match.projectId === project.id
                ? ('LINKED' as const)
                : ('OTHER_PROJECT' as const)
              : ('NOT_LINKED' as const),
            id: match?.id ?? null,
            projectId: match?.projectId ?? null,
            name: repository.name,
            canonicalUrl: repository.canonicalUrl,
            cloneUrl: repository.cloneUrl,
            credentials,
          },
        ];
      }),
    ];
  }

  /** Register a repository. It joins no hub here; hubs pick their repositories. */
  async createRepository(
    actor: SdlcActor,
    input: AttachSdlcRepositoryInput
  ): Promise<SdlcRepository> {
    const parsedRepository = sdlcVcs.parseRepositoryUrl(input.url);
    const canonicalUrl = parsedRepository.canonicalUrl;
    const name = (input.name?.trim() || parsedRepository.name).slice(0, 120);
    if (!name) {
      throw new AppError('Repository name is required', 400);
    }

    try {
      const repository = await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: input.projectId, workspaceId: actor.workspaceId },
          select: { id: true },
        });
        if (!project) {
          throw new AppError('Project not found', 404);
        }
        await this.requireProjectBoardAccess(tx, actor, project.id);
        const vcsCredentialId = await this.chooseCredential(actor, parsedRepository, input.credentialId);
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
      try {
        await sdlcVcs.checkRepositoryAccess(actor, repository.id);
      } catch (error) {
        logger.error('[SDLC] automatic access check failed', {
          repoId: repository.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return repository;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('This repository is already registered in this workspace', 409);
      }
      throw error;
    }
  }

  private async chooseCredential(
    actor: SdlcActor,
    repository: ParsedRepository,
    requestedId: string | undefined
  ): Promise<string | null> {
    const candidates = await sdlcVcs.credentialsForRepository(actor.workspaceId, repository);
    if (requestedId) {
      if (!candidates.some((candidate) => candidate.id === requestedId)) {
        throw new AppError(`That credential does not serve ${repository.host}`, 400);
      }
      return requestedId;
    }
    if (candidates.length === 1) return candidates[0]!.id;
    if (candidates.length > 1) {
      throw new AppError(`Several credentials serve ${repository.host}; choose one`, 409);
    }
    // Public GitHub repositories work anonymously; any other host needs a credential to be recognised.
    if (repository.provider !== 'GITHUB') {
      throw new AppError(
        `No repository credential serves ${repository.host}. Ask a workspace admin to add one.`,
        400
      );
    }
    return null;
  }

  /** The private channel a hub lives in, plus its starting artifact-type folders. */
  private async createSdlcChannel(
    tx: TransactionClient,
    actor: SdlcActor,
    input: { projectId: string; name: string }
  ): Promise<string> {
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

  async createChannel(actor: SdlcActor, input: CreateSdlcChannelInput): Promise<SdlcChannel> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, workspaceId: actor.workspaceId },
        select: { id: true },
      });
      if (!project) {
        throw new AppError('Project not found', 404);
      }
      await this.requireProjectBoardAccess(tx, actor, project.id);

      const channelId = await this.createSdlcChannel(tx, actor, {
        projectId: project.id,
        name: input.name,
      });

      const repoIds = await this.attachRepositoriesToChannel(tx, actor, channelId, input.repoIds);

      return { id: channelId, name: input.name.trim(), projectId: project.id, repoIds };
    });
  }

  async addChannelRepositories(
    actor: SdlcActor,
    channelId: string,
    repoIds: string[]
  ): Promise<{ repoIds: string[] }> {
    await this.requireChannelRole(actor, channelId, true);
    return this.prisma.$transaction(async (tx) => ({
      repoIds: await this.attachRepositoriesToChannel(tx, actor, channelId, repoIds),
    }));
  }

  /** Detach only. The repository survives; other hubs may still cover it. */
  async removeChannelRepository(
    actor: SdlcActor,
    channelId: string,
    repoId: string
  ): Promise<void> {
    await this.requireChannelRole(actor, channelId, true);
    const [columnArtifacts, linkedArtifacts] = await Promise.all([
      this.prisma.sdlcArtifact.count({
        where: { repoId, canvas: { is: { channelId } } },
      }),
      this.prisma.sdlcEntityLink.count({
        where: {
          channelId,
          sourceType: 'CANVAS',
          targetType: 'REPOSITORY',
          targetId: repoId,
          relationType: SDLC_ARTIFACT_REPOSITORY_RELATION,
        },
      }),
    ]);
    if (columnArtifacts + linkedArtifacts > 0) {
      throw new AppError(
        'This repository still has artifacts in this hub. Delete them before detaching it.',
        409
      );
    }
    const removed = await this.prisma.sdlcEntityLink.deleteMany({
      where: {
        channelId,
        targetType: 'REPOSITORY',
        targetId: repoId,
        relationType: SDLC_MEMBERSHIP_RELATION,
      },
    });
    if (removed.count === 0) {
      throw new AppError('Repository is not part of this hub', 404);
    }
  }

  /** A Wiki page is an artifact whose placement belongs to the Wiki store, not a type folder. */
  async createWikiPage(
    actor: SdlcActor,
    input: CreateSdlcClawWikiPageInput
  ): Promise<SdlcArtifact> {
    await this.requireChannelRole(actor, input.channelId, true);
    const page = await sdlcWikiPageStore.write({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      channelId: input.channelId,
      ...(input.repoId ? { repoId: input.repoId } : {}),
      page: {
        action: 'create',
        title: input.title,
        ...(input.folderPath ? { folderPath: input.folderPath } : {}),
        markdown: input.markdown,
      },
    });
    return { canvasId: page.canvasId, url: `/chat/canvas/${page.canvasId}` };
  }

  /** Archiving drops the document out of Hub Knowledge reads and the Wiki tree. */
  async setArtifactArchived(
    actor: SdlcActor,
    channelId: string,
    canvasId: string,
    archived: boolean
  ): Promise<void> {
    await this.requireChannelRole(actor, channelId, true);
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: canvasId, channelId },
      select: { sdlcArtifact: { select: { artifactType: true } } },
    });
    if (!canvas?.sdlcArtifact) throw new AppError('SDLC artifact not found', 404);
    const artifactType = canvas.sdlcArtifact.artifactType;
    if (artifactType !== 'WIKI' && artifactType !== SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE) {
      throw new AppError('Only Wiki pages and Hub Knowledge documents can be archived here', 400);
    }
    await this.prisma.sdlcArtifact.update({
      where: { artifactId: canvasId },
      data: { artifactStatus: archived ? 'ARCHIVED' : 'ACTIVE' },
    });
  }

  async getChannel(actor: SdlcActor, channelId: string): Promise<SdlcChannel> {
    const channel = await this.requireChannelRole(actor, channelId, false);
    const memberships = await this.prisma.sdlcEntityLink.findMany({
      where: { channelId, relationType: SDLC_MEMBERSHIP_RELATION },
      orderBy: { createdAt: 'asc' },
      select: { targetId: true },
    });
    return {
      id: channel.id,
      name: channel.name,
      projectId: channel.projectId,
      repoIds: memberships.map((membership) => membership.targetId),
    };
  }

  private async attachRepositoriesToChannel(
    tx: TransactionClient,
    actor: SdlcActor,
    channelId: string,
    repoIds: readonly string[]
  ): Promise<string[]> {
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

  async getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string,
    channelId?: string
  ): Promise<SdlcRepositoryRunContext> {
    const repo = await this.requireRepositoryRole(actor, repoId, false, channelId);
    const agentContext = await sdlcAgentContext.build(actor, repo.id, {
      conversationId,
      channelId: repo.channelId,
    });
    return {
      repoId: repo.id,
      channelId: repo.channelId,
      name: repo.name,
      url: sdlcVcs.parseRepositoryUrl(repo.canonicalUrl || repo.url).cloneUrl,
      baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      agentContext,
    };
  }

  async listRepositoryRunContexts(
    actor: SdlcActor,
    query = '',
    limit = 20,
    channelId?: string
  ): Promise<SdlcRepositoryRunContext[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const trimmedQuery = query.trim();
    const memberships = await this.prisma.sdlcEntityLink.findMany({
      where: {
        workspaceId: actor.workspaceId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        // A named public hub lists its repositories to anyone in the workspace.
        ...(channelId
          ? {
              channelId,
              channel: {
                OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: actor.userId } } }],
              },
            }
          : { channel: { participants: { some: { userId: actor.userId } } } }),
      },
      select: { targetId: true, channelId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const channelIdByRepoId = new Map<string, string>();
    for (const membership of memberships) {
      if (!membership.channelId) continue;
      if (!channelIdByRepoId.has(membership.targetId)) {
        channelIdByRepoId.set(membership.targetId, membership.channelId);
      }
    }
    const repoIds = [...channelIdByRepoId.keys()];
    if (repoIds.length === 0) return [];

    const repos = await this.prisma.repo.findMany({
      where: {
        workspaceId: actor.workspaceId,
        id: { in: repoIds },
        ...(trimmedQuery
          ? {
              OR: [
                { name: { contains: trimmedQuery, mode: 'insensitive' as const } },
                { canonicalUrl: { contains: trimmedQuery, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: safeLimit,
      select: { id: true, name: true, url: true, canonicalUrl: true, baseBranch: true },
    });

    return repos.flatMap((repo) => {
      const repoChannelId = channelIdByRepoId.get(repo.id);
      if (!repoChannelId) return [];
      try {
        return [
          {
            repoId: repo.id,
            channelId: repoChannelId,
            name: repo.name,
            url: sdlcVcs.parseRepositoryUrl(repo.canonicalUrl || repo.url).cloneUrl,
            baseBranch: requireSdlcBaseBranch(repo.baseBranch),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async createArtifactFromClaw(
    actor: SdlcActor,
    input: CreateSdlcClawArtifactInput
  ): Promise<SdlcArtifact> {
    const channelId = (await this.hubOf('canvasFolder', input.folderId)) ?? input.channelId;
    if (!channelId) throw new AppError('An SDLC hub is required to create an artifact', 400);
    const channel = await this.requireChannelRole(actor, channelId, false);
    if (!channel.projectId) throw new AppError('SDLC hub not found', 404);
    const projectId = channel.projectId;

    const repoIds = sdlcRepoIds(input);
    const repo = repoIds[0]
      ? await this.requireRepositoryRole(actor, repoIds[0], false, channelId)
      : null;
    for (const extraRepoId of repoIds.slice(1)) {
      if (!(await isRepositoryInChannel(this.prisma, extraRepoId, channelId))) {
        throw new AppError('A named repository is not part of this hub', 404);
      }
    }
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { id: input.folderId, channelId },
      select: { id: true, name: true },
    });
    if (!folder) throw new AppError('Artifact type folder not found', 409);

    const hubKnowledge = folder.name === SDLC_HUB_KNOWLEDGE_FOLDER;
    if (!input.trackId && !hubKnowledge) {
      throw new AppError('Artifacts require a track', 400);
    }
    if (hubKnowledge) {
      // Every member's runs read Hub Knowledge.
      await this.requireChannelRole(actor, channelId, true);
      const existing = await this.prisma.canvas.findFirst({
        where: {
          folderId: folder.id,
          title: { equals: input.title, mode: 'insensitive' },
          sdlcArtifact: { is: { artifactStatus: 'ACTIVE' } },
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(
          `Hub Knowledge already has "${input.title}" (canvasId ${existing.id}). Update that artifact instead.`,
          409
        );
      }
    }

    if (input.trackId) {
      const inHub = await isTrackInChannel(this.prisma, input.trackId, channelId);
      if (!inHub) throw new AppError('SDLC track not found in this hub', 404);
    }
    // The hub UI names a track's own page by the track id, so that means the track's top level.
    const trackFolderId = input.trackFolderId === input.trackId ? undefined : input.trackFolderId;
    if (trackFolderId && (!input.trackId || (await resolveFolderTrackId(this.prisma, trackFolderId)) !== input.trackId)) {
      throw new AppError('Track folder not found in this track', 404);
    }

    // No file/line verification: code links are free markdown, so a wrong path or range shows up as a broken link, not an error.
    const content = await convertMarkdownToBlockNote(input.markdown);
    const artifact = await commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
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
        }),
      syncToYSweet,
      actor.userId
    );
    this.enqueueCanvasIndexing(artifact.canvasId, actor.workspaceId, actor.userId);
    return artifact;
  }

  private enqueueCanvasIndexing(canvasId: string, workspaceId: string, userId: string): void {
    void vespaQueue
      .addJob({
        schema: fileSchema,
        jobType: 'feed',
        docId: canvasId,
        userId,
        workspaceId,
        app: SubApp.CANVAS,
      })
      .catch(err => {
        logger.warn('[SDLC] failed to enqueue canvas indexing', {
          canvasId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async updateArtifactFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcClawArtifactInput
  ): Promise<SdlcArtifact> {
    const channelId = (await this.hubOf('canvas', input.canvasId)) ?? input.channelId;
    if (!channelId) throw new AppError('SDLC artifact not found', 404);
    await this.requireChannelRole(actor, channelId, false);
    const existing = await this.prisma.canvas.findFirst({
      where: {
        id: input.canvasId,
        channelId,
        sdlcArtifact: { isNot: null },
      },
      select: { id: true, viewAccessId: true, title: true },
    });
    if (!existing) throw new AppError('SDLC artifact not found', 404);
    const existingEntity = await this.prisma.sdlcArtifact.findUnique({
      where: { artifactId: existing.id },
      select: { repoId: true },
    });
    const repoId = sdlcRepoIds(input)[0] ?? existingEntity?.repoId ?? null;
    const repo = repoId
      ? await this.requireRepositoryRole(actor, repoId, false, channelId)
      : null;
    if (input.markdown === undefined) {
      // Title or links only: the content and its Y-Sweet copy stay as they are.
      const canvas = await this.prisma.$transaction(async (tx) => {
        await linkRelatedCanvases(tx, actor, channelId, existing.id, input.relatedCanvasIds);
        if (!input.title) return existing;
        return tx.canvas.update({
          where: { id: existing.id },
          data: { title: input.title, lastEditedBy: actor.userId, lastEditedAt: new Date() },
          select: { id: true, viewAccessId: true },
        });
      });
      return {
        canvasId: canvas.id,
        viewAccessId: canvas.viewAccessId ?? undefined,
        url: `/chat/canvas/${canvas.viewAccessId ?? canvas.id}`,
      };
    }
    return this.writeArtifactContent(actor, channelId, existing.id, input.markdown, {
      title: input.title,
      repoId: repo?.id,
      relatedCanvasIds: input.relatedCanvasIds,
    });
  }

  /** Content write after the caller has checked the hub role and found the artifact. */
  private async writeArtifactContent(
    actor: SdlcActor,
    channelId: string,
    canvasId: string,
    markdown: string,
    extra: { title?: string | undefined; repoId?: string | undefined; relatedCanvasIds?: string[] | undefined } = {}
  ): Promise<SdlcArtifact> {
    const content = await convertMarkdownToBlockNote(markdown);
    return commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
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
        }),
      syncToYSweet,
      actor.userId
    );
  }

  async editArtifactSectionFromClaw(
    actor: SdlcActor,
    input: EditSdlcClawArtifactSectionInput
  ): Promise<SdlcArtifact> {
    const existing = await this.requireClawArtifact(actor, input.canvasId);
    const markdown = mutateMarkdownSection({
      markdown: await readCanvasMarkdown(existing),
      action: input.action,
      heading: input.heading,
      ...(input.action === 'remove_section' ? {} : { sectionMarkdown: input.markdown }),
    });
    return this.writeArtifactContent(actor, existing.channelId, existing.id, markdown);
  }

  // Within the artifact's own track only, like the hub UI; extend this when items can move between tracks.
  async moveArtifactFromClaw(
    actor: SdlcActor,
    input: MoveSdlcClawArtifactInput
  ): Promise<{ canvasId: string; parentId: string }> {
    const { channelId } = await this.requireClawArtifact(actor, input.canvasId);
    const trackId = await resolveItemTrackId(this.prisma, 'CANVAS', input.canvasId);
    if (!trackId) throw new AppError('Only artifacts filed in a track can be moved', 409);
    const toRoot = input.parentId === trackId;
    if (!toRoot) {
      const parentTrackId = await resolveFolderTrackId(this.prisma, input.parentId);
      if (!parentTrackId) throw new AppError('Track folder not found', 404);
      if (parentTrackId !== trackId) throw new AppError('An artifact can only be moved within its own track', 409);
    }
    await this.prisma.$transaction(async tx => {
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
    });
    return { canvasId: input.canvasId, parentId: input.parentId };
  }

  async archiveArtifactFromClaw(
    actor: SdlcActor,
    input: ArchiveSdlcClawArtifactInput
  ): Promise<{ canvasId: string; archived: boolean }> {
    await this.requireClawArtifact(actor, input.canvasId);
    await this.prisma.sdlcArtifact.update({
      where: { artifactId: input.canvasId },
      data: { artifactStatus: input.archived ? 'ARCHIVED' : 'ACTIVE' },
    });
    return { canvasId: input.canvasId, archived: input.archived };
  }

  private async requireClawArtifact(actor: SdlcActor, canvasId: string) {
    const channelId = await this.hubOf('canvas', canvasId);
    if (!channelId) throw new AppError('SDLC artifact not found', 404);
    await this.requireChannelRole(actor, channelId, false);
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: canvasId, channelId, sdlcArtifact: { isNot: null } },
      select: { id: true, createdBy: true, content: true },
    });
    if (!canvas) throw new AppError('SDLC artifact not found', 404);
    return { ...canvas, channelId };
  }

  async linkContext(
    actor: SdlcActor,
    repoId: string | null,
    input: CreateSdlcLinkInput,
    channelId?: string
  ): Promise<SdlcLink> {
    if (input.relationType === 'DISCUSSION') {
      throw new AppError('SDLC discussions must be created with their conversation', 400);
    }
    let hubId = channelId;
    if (repoId) {
      hubId = (await this.requireRepositoryRole(actor, repoId, false, channelId)).channelId;
    } else {
      if (!hubId) throw new AppError('An SDLC hub is required to create a relationship', 400);
      await this.requireChannelRole(actor, hubId, false);
    }
    const hubChannelId = hubId!;
    await this.requireLinkSource(repoId, hubChannelId, input.sourceType, input.sourceId);
    await this.requireAccessibleEntity(actor, input.targetType, input.targetId);
    try {
      const link = await this.prisma.sdlcEntityLink.create({
        data: {
          ...input,
          workspaceId: actor.workspaceId,
          channelId: hubChannelId,
          createdBy: actor.userId,
        },
      });
      // Propagate the source artifact's track onto the ticket so the ticket shows
      // under the same track (same TRACK_ITEM entity link we use for PRDs/Tech Docs).
      if (input.targetType === 'TICKET' && input.sourceType === 'CANVAS') {
        const trackLink = await this.prisma.sdlcEntityLink.findFirst({
          where: {
            channelId: hubChannelId,
            sourceType: 'TRACK',
            targetType: 'CANVAS',
            targetId: input.sourceId,
            relationType: SDLC_TRACK_FLAT_RELATION,
          },
          select: { sourceId: true },
        });
        if (trackLink) {
          await ensureLink(
            this.prisma,
            {
              channelId: hubChannelId,
              sourceType: 'TRACK',
              sourceId: trackLink.sourceId,
              targetType: 'TICKET',
              targetId: input.targetId,
              relationType: 'TRACK_ITEM',
            },
            { workspaceId: actor.workspaceId, userId: actor.userId }
          );
        }
      }
      return link;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('This SDLC relationship already exists', 409);
      }
      throw error;
    }
  }

  /**
   * Where a hub conversation opens. Null when it has no place of its own.
   * The rule lives in sdlc_entity_links, so a client cannot derive it from the message.
   */
  async navTarget(
    actor: SdlcActor,
    channelId: string,
    ids: { conversationId: string; messageId?: string }
  ): Promise<SdlcNavTarget | null> {
    await this.requireChannelRole(actor, channelId, false);
    return resolveSdlcNavTarget({ channelId, ...ids });
  }

  async listTracks(actor: SdlcActor, channelId: string) {
    await requireSdlcHubReader(this.prisma, actor, channelId);
    // Tracks carry no scope column; the CHANNEL -> TRACK edges name the hub's tracks.
    const trackIds = await trackIdsForChannel(this.prisma, channelId);
    const [tracks, flatEdges] = await Promise.all([
      this.prisma.sdlcTrack.findMany({
        where: { id: { in: trackIds } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.sdlcEntityLink.findMany({
        where: {
          channelId,
          sourceType: 'TRACK',
          sourceId: { in: trackIds },
          targetType: 'FOLDER',
          relationType: SDLC_TRACK_FLAT_RELATION,
        },
        select: { sourceId: true, targetId: true },
      }),
    ]);
    const folderIds = flatEdges.map(edge => edge.targetId);
    const [folders, parentEdges] = await Promise.all([
      this.prisma.sdlcFolder.findMany({ where: { id: { in: folderIds } }, select: { id: true, name: true } }),
      this.prisma.sdlcEntityLink.findMany({
        where: { channelId, targetType: 'FOLDER', targetId: { in: folderIds }, relationType: SDLC_CONTAINMENT_RELATION },
        select: { sourceId: true, targetId: true },
      }),
    ]);
    const folderName = new Map(folders.map(folder => [folder.id, folder.name]));
    const parentOf = new Map(parentEdges.map(edge => [edge.targetId, edge.sourceId]));
    return tracks.map(track => ({
      ...track,
      // parentId is the track itself for a top-level folder.
      folders: flatEdges
        .filter(edge => edge.sourceId === track.id && folderName.has(edge.targetId))
        .map(edge => ({
          id: edge.targetId,
          name: folderName.get(edge.targetId)!,
          parentId: parentOf.get(edge.targetId) ?? track.id,
        })),
    }));
  }

  // Mirrors the createSdlcFolder Zero mutator the hub UI uses.
  async createTrackFolderFromClaw(actor: SdlcActor, input: CreateSdlcClawTrackFolderInput) {
    await this.requireChannelRole(actor, input.channelId, false);
    if (!(await isTrackInChannel(this.prisma, input.trackId, input.channelId))) {
      throw new AppError('SDLC track not found in this hub', 404);
    }
    if (
      input.parentTrackFolderId &&
      (await resolveFolderTrackId(this.prisma, input.parentTrackFolderId)) !== input.trackId
    ) {
      throw new AppError('Track folder not found in this track', 404);
    }
    const actorRef = { workspaceId: actor.workspaceId, userId: actor.userId };
    return this.prisma.$transaction(async tx => {
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
      return { ...folder, trackId: input.trackId, parentId: input.parentTrackFolderId ?? input.trackId };
    });
  }

  async createTrack(actor: SdlcActor, input: CreateSdlcTrackInput) {
    await this.requireChannelRole(actor, input.channelId, false);
    const channelId = input.channelId;
    return this.prisma.$transaction(async (tx) => {
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

  async listArtifactTypes(actor: SdlcActor, channelId: string) {
    await requireSdlcHubReader(this.prisma, actor, channelId);
    return this.prisma.canvasFolder.findMany({
      // Wiki pages are written through the Wiki actions, never as artifacts of a type.
      where: { channelId, name: { not: SDLC_WIKI_FOLDER } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    });
  }

  async createArtifactType(actor: SdlcActor, channelId: string, name: string) {
    const channel = await this.requireChannelRole(actor, channelId, false);
    if (!channel.projectId) throw new AppError('SDLC hub not found', 404);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('Artifact type name is required', 400);
    const existing = await this.prisma.canvasFolder.findFirst({
      where: { channelId, name: trimmed },
      select: { id: true },
    });
    if (existing) throw new AppError('An artifact type with this name already exists', 409);
    return this.prisma.canvasFolder.create({
      data: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        projectId: channel.projectId,
        channelId,
        name: trimmed,
        createdBy: actor.userId,
      },
      select: { id: true, name: true },
    });
  }

  async renameArtifactType(
    actor: SdlcActor,
    channelId: string,
    folderId: string,
    name: string
  ) {
    await this.requireChannelRole(actor, channelId, false);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('Artifact type name is required', 400);
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { id: folderId, channelId },
      select: { id: true, name: true },
    });
    if (!folder) throw new AppError('Artifact type not found', 404);
    if (folder.name === SDLC_HUB_KNOWLEDGE_FOLDER) {
      throw new AppError('Hub Knowledge cannot be renamed', 400);
    }
    const clash = await this.prisma.canvasFolder.findFirst({
      where: { channelId, name: trimmed, id: { not: folderId } },
      select: { id: true },
    });
    if (clash) throw new AppError('An artifact type with this name already exists', 409);
    return this.prisma.canvasFolder.update({
      where: { id: folderId },
      data: { name: trimmed },
      select: { id: true, name: true },
    });
  }

  async unlinkContext(actor: SdlcActor, repoId: string, linkId: string): Promise<void> {
    const repo = await this.requireRepositoryRole(
      actor,
      repoId,
      false,
      await this.hubOf('sdlcEntityLink', linkId)
    );
    const link = await this.prisma.sdlcEntityLink.findFirst({
      where: { id: linkId, channelId: repo.channelId, workspaceId: actor.workspaceId },
      select: { relationType: true },
    });
    if (!link) {
      throw new AppError('SDLC relationship not found', 404);
    }
    if (link.relationType === 'DISCUSSION') {
      throw new AppError('Delete the conversation to remove an SDLC discussion', 400);
    }
    if ((SDLC_STRUCTURAL_RELATIONS as readonly string[]).includes(link.relationType)) {
      throw new AppError('Structural SDLC edges are not deleted through the link API', 400);
    }
    const result = await this.prisma.sdlcEntityLink.deleteMany({
      where: { id: linkId, channelId: repo.channelId, workspaceId: actor.workspaceId },
    });
    if (result.count === 0) {
      throw new AppError('SDLC relationship not found', 404);
    }
  }

  async listEntityLinks(actor: SdlcActor, input: ListSdlcEntityLinksInput) {
    await requireSdlcHubReader(this.prisma, actor, input.channelId);
    const scope = {
      channelId: input.channelId,
      workspaceId: actor.workspaceId,
      ...(input.relationType ? { relationType: input.relationType } : {}),
    };
    const select = {
      id: true,
      sourceType: true,
      sourceId: true,
      targetType: true,
      targetId: true,
      relationType: true,
      createdAt: true,
    } as const;
    const [outgoing, incoming] = await Promise.all([
      this.prisma.sdlcEntityLink.findMany({
        where: {
          ...scope,
          sourceType: input.entityType,
          sourceId: input.entityId,
          ...(input.otherType ? { targetType: input.otherType } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: input.limit,
        select,
      }),
      this.prisma.sdlcEntityLink.findMany({
        where: {
          ...scope,
          targetType: input.entityType,
          targetId: input.entityId,
          ...(input.otherType ? { sourceType: input.otherType } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: input.limit,
        select,
      }),
    ]);
    const edges = [
      ...outgoing.map((link) => ({
        linkId: link.id,
        direction: 'OUTGOING' as const,
        relationType: link.relationType,
        otherType: link.targetType,
        otherId: link.targetId,
        createdAt: link.createdAt,
      })),
      ...incoming.map((link) => ({
        linkId: link.id,
        direction: 'INCOMING' as const,
        relationType: link.relationType,
        otherType: link.sourceType,
        otherId: link.sourceId,
        createdAt: link.createdAt,
      })),
    ].slice(0, input.limit);
    const names = await this.entityNames(actor, input.channelId, edges);
    return edges.map((edge) => ({
      ...edge,
      otherName: names.get(`${edge.otherType}:${edge.otherId}`) ?? null,
    }));
  }

  // Channel-scoped names only when the actor can see that channel: a link can point outside the hub.
  private async entityNames(
    actor: SdlcActor,
    hubId: string,
    edges: ReadonlyArray<{ otherType: string; otherId: string }>
  ): Promise<Map<string, string>> {
    const idsOf = (type: string) => [
      ...new Set(edges.filter((edge) => edge.otherType === type).map((edge) => edge.otherId)),
    ];
    const workspaceId = actor.workspaceId;
    const [canvases, tickets, channels, calls, messages, emails, repos, tracks, folders, pullRequests, workflows] =
      await Promise.all([
        this.prisma.canvas.findMany({
          where: { id: { in: idsOf('CANVAS') }, workspaceId },
          select: { id: true, title: true, channelId: true },
        }),
        this.prisma.ticket.findMany({
          where: { id: { in: idsOf('TICKET') }, workspaceId },
          select: { id: true, title: true, channelId: true },
        }),
        this.prisma.channel.findMany({
          where: { id: { in: idsOf('CHANNEL') }, workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.call.findMany({
          where: { id: { in: idsOf('CALL') }, workspaceId },
          select: { id: true, title: true, channelId: true },
        }),
        this.prisma.message.findMany({
          where: { messageId: { in: idsOf('MESSAGE') }, workspaceId },
          select: { messageId: true, content: true, conversation: { select: { channelId: true } } },
        }),
        this.prisma.email.findMany({
          where: { id: { in: idsOf('EMAIL') }, workspaceId },
          select: { id: true, subject: true, channelId: true },
        }),
        this.prisma.repo.findMany({
          where: { id: { in: idsOf('REPOSITORY') }, workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.sdlcTrack.findMany({
          where: { id: { in: idsOf('TRACK') }, workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.canvasFolder.findMany({
          where: { id: { in: idsOf('FOLDER') }, workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.pullRequests.findMany({
          where: { id: { in: idsOf('PULL_REQUEST') }, workspaceId },
          select: { id: true, repoName: true, prId: true },
        }),
        this.prisma.workflow.findMany({
          where: { id: { in: idsOf('WORKFLOW') }, workspaceId },
          select: { id: true, workflowName: true, summary: true },
        }),
      ]);

    const channelIds = new Set<string>();
    for (const row of [...canvases, ...tickets, ...calls, ...emails]) {
      if (row.channelId && row.channelId !== hubId) channelIds.add(row.channelId);
    }
    for (const row of messages) {
      if (row.conversation.channelId !== hubId) channelIds.add(row.conversation.channelId);
    }
    const visible = new Set(
      channelIds.size === 0
        ? []
        : (
            await this.prisma.channelParticipant.findMany({
              where: { userId: actor.userId, channelId: { in: [...channelIds] } },
              select: { channelId: true },
            })
          ).map((row) => row.channelId)
    );
    const canSee = (channelId: string | null) => !channelId || channelId === hubId || visible.has(channelId);

    const names = new Map<string, string>();
    const put = (type: string, id: string, name: string | null | undefined) => {
      if (name) names.set(`${type}:${id}`, name.slice(0, 200));
    };
    canvases.forEach((row) => canSee(row.channelId) && put('CANVAS', row.id, row.title));
    tickets.forEach((row) => canSee(row.channelId) && put('TICKET', row.id, row.title));
    calls.forEach((row) => canSee(row.channelId) && put('CALL', row.id, row.title));
    emails.forEach((row) => canSee(row.channelId) && put('EMAIL', row.id, row.subject));
    messages.forEach(
      (row) => canSee(row.conversation.channelId) && put('MESSAGE', row.messageId, row.content)
    );
    channels.forEach((row) => put('CHANNEL', row.id, row.name));
    repos.forEach((row) => put('REPOSITORY', row.id, row.name));
    tracks.forEach((row) => put('TRACK', row.id, row.name));
    folders.forEach((row) => put('FOLDER', row.id, row.name));
    pullRequests.forEach((row) => put('PULL_REQUEST', row.id, `${row.repoName} #${row.prId}`));
    workflows.forEach((row) => put('WORKFLOW', row.id, row.workflowName ?? row.summary));
    return names;
  }

  private async requireProjectBoardAccess(
    tx: TransactionClient | PrismaClient,
    actor: SdlcActor,
    projectId: string
  ): Promise<void> {
    await requireSdlcProjectAccess(
      tx,
      actor,
      projectId,
      'You must be a project participant to attach a repository'
    );
  }


  /** Gate for hub-scoped work: artifact types, artifacts, links, tracks, membership. */
  // Every item in a hub is readable by the hub today; per-item privacy would need its own check.
  private async requireChannelRole(actor: SdlcActor, channelId: string, requireAdmin: boolean) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId: actor.workspaceId, type: ChannelType.SDLC },
      select: {
        id: true,
        name: true,
        projectId: true,
        participants: { where: { userId: actor.userId }, select: { role: true } },
      },
    });
    if (!channel) {
      throw new AppError('SDLC hub not found', 404);
    }
    const participant = channel.participants[0];
    if (!participant) {
      throw new AppError('You are not a member of this hub', 403);
    }
    if (requireAdmin && participant.role !== ChannelRole.ADMIN) {
      throw new AppError('Hub admin access is required', 403);
    }
    return channel;
  }

  /**
   * Gate for repo-scoped work. Access comes from the hubs the repository belongs to,
   * so this also resolves which hub the operation runs in and returns it as
   * `channelId`. Pass `channelId` when the caller knows it; otherwise the actor's
   * oldest accessible membership wins.
   */
  /**
   * A repository sits in several hubs, so its hub cannot be inferred from it.
   * Hub-scoped work reads the hub off the row it addresses.
   */
  private async hubOf(
    table: 'canvasFolder' | 'canvas' | 'sdlcEntityLink',
    id: string
  ): Promise<string | undefined> {
    const row = await (
      this.prisma[table] as { findFirst: (args: unknown) => Promise<{ channelId: string | null } | null> }
    ).findFirst({ where: { id }, select: { channelId: true } });
    return row?.channelId ?? undefined;
  }

  private async requireRepositoryRole(
    actor: SdlcActor,
    repoId: string,
    requireAdmin: boolean,
    channelId?: string
  ) {
    const repo = await this.prisma.repo.findFirst({
      where: { id: repoId, workspaceId: actor.workspaceId },
    });
    if (!repo || !repo.projectId) {
      throw new AppError('SDLC repository not found', 404);
    }

    const memberships = await this.prisma.sdlcEntityLink.findMany({
      where: {
        targetType: 'REPOSITORY',
        targetId: repoId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        ...(channelId ? { channelId } : {}),
        channel: { participants: { some: { userId: actor.userId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        channelId: true,
        channel: {
          select: {
            participants: { where: { userId: actor.userId }, select: { role: true } },
          },
        },
      },
    });
    if (memberships.length === 0) {
      throw new AppError('You are not a member of this repository', 403);
    }
    // Role differs per hub, so an admin action is allowed from any hub the actor
    // administers, not only the oldest.
    const membership = requireAdmin
      ? memberships.find(
          (candidate) => candidate.channel?.participants[0]?.role === ChannelRole.ADMIN
        )
      : memberships[0];
    if (!membership?.channelId) {
      throw new AppError('Repository admin access is required', 403);
    }

    // channelId replaces the old repos.channelId for every repo-scoped caller.
    return { ...repo, channelId: membership.channelId };
  }

  private async requireLinkSource(
    repoId: string | null,
    channelId: string,
    type: string,
    id: string
  ): Promise<void> {
    let exists: { id: string } | null = null;
    if (type === 'CANVAS') {
      exists = await this.prisma.canvas.findFirst({
        where: { id, channelId },
        select: { id: true },
      });
    } else if (type === 'TICKET') {
      exists = await this.prisma.ticket.findFirst({
        where: { id, channelId },
        select: { id: true },
      });
    } else if (type === 'CHANNEL' && id === channelId) {
      exists = { id };
    } else if (type === 'PULL_REQUEST') {
      const pullRequest = await this.prisma.pullRequests.findUnique({
        where: { id },
        select: { id: true, ticketId: true },
      });
      if (pullRequest?.ticketId) {
        const ticket = await this.prisma.ticket.findFirst({
          where: { id: pullRequest.ticketId, channelId },
          select: { id: true },
        });
        if (ticket) exists = { id: pullRequest.id };
      }
    }
    if (!exists) {
      throw new AppError(
        `Invalid ${type} source for ${repoId ? `repository ${repoId}` : `hub ${channelId}`}`,
        400
      );
    }
  }

  private async requireAccessibleEntity(actor: SdlcActor, type: string, id: string): Promise<void> {
    let workspaceId: string | null | undefined;
    let channelId: string | null | undefined;
    switch (type) {
      case 'CANVAS': {
        const value = await this.prisma.canvas.findUnique({
          where: { id },
          select: { workspaceId: true, channelId: true, createdBy: true },
        });
        if (value?.createdBy === actor.userId && value.workspaceId === actor.workspaceId) return;
        workspaceId = value?.workspaceId;
        channelId = value?.channelId;
        break;
      }
      case 'TICKET': {
        const value = await this.prisma.ticket.findUnique({
          where: { id },
          select: { workspaceId: true, channelId: true },
        });
        workspaceId = value?.workspaceId;
        channelId = value?.channelId;
        break;
      }
      case 'CHANNEL': {
        const value = await this.prisma.channel.findUnique({
          where: { id },
          select: { workspaceId: true, id: true },
        });
        workspaceId = value?.workspaceId;
        channelId = value?.id;
        break;
      }
      case 'CONVERSATION': {
        const value = await this.prisma.conversation.findUnique({
          where: { conversationId: id },
          select: { workspaceId: true, channelId: true },
        });
        workspaceId = value?.workspaceId;
        channelId = value?.channelId;
        break;
      }
      case 'MESSAGE': {
        const value = await this.prisma.message.findUnique({
          where: { messageId: id },
          include: { conversation: { select: { channelId: true } } },
        });
        workspaceId = value?.workspaceId;
        channelId = value?.conversation.channelId;
        break;
      }
      case 'EMAIL': {
        const value = await this.prisma.email.findUnique({
          where: { id },
          select: { workspaceId: true, channelId: true },
        });
        workspaceId = value?.workspaceId;
        channelId = value?.channelId;
        break;
      }
      case 'CALL': {
        const value = await this.prisma.call.findUnique({
          where: { id },
          select: { workspaceId: true, channelId: true, createdByUserId: true },
        });
        if (value?.createdByUserId === actor.userId && value.workspaceId === actor.workspaceId)
          return;
        workspaceId = value?.workspaceId;
        channelId = value?.channelId;
        break;
      }
      case 'RECORDING': {
        const value = await this.prisma.callRecording.findUnique({
          where: { id },
          include: { call: { select: { channelId: true } } },
        });
        if (value?.startedBy === actor.userId && value.workspaceId === actor.workspaceId) return;
        workspaceId = value?.workspaceId;
        channelId = value?.call.channelId;
        break;
      }
      case 'ATTACHMENT': {
        const value = await this.prisma.messageAttachment.findUnique({
          where: { id },
          include: { conversation: { select: { channelId: true } } },
        });
        if (value?.uploadedByUserId === actor.userId && value.workspaceId === actor.workspaceId)
          return;
        workspaceId = value?.workspaceId;
        channelId = value?.conversation?.channelId;
        break;
      }
      case 'PULL_REQUEST': {
        const value = await this.prisma.pullRequests.findUnique({
          where: { id },
          select: { workspaceId: true },
        });
        workspaceId = value?.workspaceId;
        break;
      }
      default:
        throw new AppError('Unsupported SDLC entity type', 400);
    }
    if (!workspaceId || workspaceId !== actor.workspaceId) {
      throw new AppError('Linked context was not found', 404);
    }
    if (!channelId && ['CANVAS', 'CALL', 'RECORDING', 'ATTACHMENT'].includes(type)) {
      throw new AppError('You cannot access the linked context', 403);
    }
    if (channelId) {
      const membership = await this.prisma.channelParticipant.findFirst({
        where: { channelId, userId: actor.userId },
        select: { id: true },
      });
      if (!membership) throw new AppError('You cannot access the linked context', 403);
    }
  }
}
