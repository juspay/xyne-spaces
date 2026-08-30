import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  SDLC_MEMBERSHIP_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  CanvasVisibility,
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  normalizeChannelName,
  validateChannelName,
  canvasTypeForSdlcArtifact,
  stringifySdlcSourceReferences,
  type AttachSdlcRepositoryInput,
  type CreateSdlcChannelInput,
  type CreateSdlcClawArtifactInput,
  type CreateSdlcLinkInput,
  type CreateSdlcTrackInput,
  type UpdateSdlcBaselineDraftInput,
  type UpdateSdlcClawArtifactInput,
} from '@xyne/shared';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { sdlcQueue } from '@/queues/sdlcQueue';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import { convertBlockNoteToMarkdown, convertMarkdownToBlockNote } from '@/services/canvasService';
import {
  cancelS2SClawRun,
  getClawDebugArtifacts,
  type ClawDebugArtifactBundle,
} from '@/services/clawAgentService';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import {
  applyBaselineDraftSection,
  baselineDraftMissingSections,
  buildBaselineDraftMarkdown,
  baselineRefreshChanged,
  finalizeBaselineDraft,
} from './sdlcBaselineDraft';
import { commitAndSyncCanvasArtifact } from './sdlcBaselineCanvasSync';
import { requireSdlcProjectAccess } from './sdlcProjectAccess';
import { isTrackInChannel, trackIdsForChannel } from './sdlcChannelMembership';
import { sdlcChannelCanvasParticipant } from './sdlcCanvasAccess';
import { BASELINE_CAPABILITIES } from './sdlcProgressiveGate';
import type {
  SdlcActor,
  SdlcArtifact,
  SdlcHub,
  SdlcLink,
  SdlcChannel,
  SdlcRepository,
  SdlcRepositoryRunContext,
  SdlcSetupExecution,
} from './types';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import { sdlcAgentContext } from './SdlcAgentContextService';
import { resolveSdlcSourceReferenceTokens, type SdlcSourceReference } from './sdlcSourceReferences';
import { sdlcVcs } from './vcs';

const SDLC_FOLDERS = ['Baseline', 'PRDs', 'Tech Docs'] as const;
const channelRepository = new ChannelRepository();
type TransactionClient = Prisma.TransactionClient;

export class SdlcHubService implements SdlcHub {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  /** Register a repository. It joins no hub here; hubs pick their repositories. */
  async createRepository(
    actor: SdlcActor,
    input: AttachSdlcRepositoryInput
  ): Promise<SdlcRepository> {
    const parsedRepository = sdlcVcs.parseRepository('GITHUB', input.url);
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
            baseBranch: [input.baseBranch],
            // Legacy required column. SDLC branch naming comes from approved
            // repository conventions, never this compatibility placeholder.
            prefix: '',
            createdBy: actor.userId,
            projectId: project.id,
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
    const artifacts = await this.prisma.sdlcArtifact.count({
      where: { repoId, canvas: { is: { channelId } } },
    });
    if (artifacts > 0) {
      throw new AppError(
        'This repository still has artifacts in this hub. Delete them before detaching it.',
        409
      );
    }
    // With no repositories a hub renders nothing and cannot be deleted, since
    // membership is what blocks channel deletion.
    const remaining = await this.prisma.sdlcEntityLink.count({
      where: { channelId, relationType: SDLC_MEMBERSHIP_RELATION },
    });
    if (remaining <= 1) {
      throw new AppError('A hub must keep at least one repository', 409);
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

    // The hub's canvas folders are project-scoped, so a repository from another
    // project would render its artifacts into folders that are not its own.
    const channel = await tx.channel.findFirst({
      where: { id: channelId, workspaceId: actor.workspaceId },
      select: { projectId: true },
    });
    if (!channel?.projectId) {
      throw new AppError('SDLC hub not found', 404);
    }
    const repos = await tx.repo.findMany({
      where: { id: { in: unique }, workspaceId: actor.workspaceId, projectId: channel.projectId },
      select: { id: true },
    });
    if (repos.length !== unique.length) {
      throw new AppError(
        'One or more repositories were not found in this hub\'s project',
        404
      );
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

    return repos.map((repo) => repo.id);
  }

  async setupRepository(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution> {
    const repo = await this.requireRepositoryRole(actor, repoId, true);
    await sdlcVcs.requireCapabilities(actor, repoId, [...BASELINE_CAPABILITIES]);
    if (repo.sdlcSetupExecutionId) {
      const existing = await this.prisma.workflowExecution.findUnique({
        where: { id: repo.sdlcSetupExecutionId },
        select: { id: true, status: true },
      });
      if (existing) {
        if (['NEW', 'PENDING', 'RUNNING', 'SCHEDULED'].includes(existing.status)) {
          throw new AppError('SDLC setup is already running', 409);
        }
        if (existing.status === 'SUCCESS') {
          return { executionId: existing.id, status: existing.status };
        }
        throw new AppError('Retry the failed SDLC setup execution', 409);
      }
    }

    const initialContext = JSON.stringify({
      repoId,
      // The hub this run was started from; a repository can be in several.
      channelId: repo.channelId,
      phase: 'QUEUED',
      completedBaselineKinds: [],
    });
    const execution = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      const lockedRepo = await tx.repo.findUnique({
        where: { id: repoId },
        select: { sdlcSetupExecutionId: true },
      });
      if (
        lockedRepo?.sdlcSetupExecutionId &&
        lockedRepo.sdlcSetupExecutionId !== repo.sdlcSetupExecutionId
      ) {
        throw new AppError('SDLC setup is already configured for this repository', 409);
      }
      const workflow = await tx.workflow.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowName: `SDLC baseline: ${repo.name}`,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context: initialContext,
          metadata: JSON.stringify({ repoId, projectId: repo.projectId }),
        },
      });
      const created = await tx.workflowExecution.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowId: workflow.id,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context: initialContext,
          createdBy: actor.userId,
        },
      });
      await tx.repo.update({
        where: { id: repoId },
        data: { sdlcSetupExecutionId: created.id },
      });
      return created;
    });

    try {
      await sdlcQueue.enqueueSetup(execution.id, repoId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.$transaction([
        this.prisma.workflowExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILURE',
            context: JSON.stringify({
              repoId,
              phase: 'PARTIALLY_FAILED',
              completedBaselineKinds: [],
              error: `Failed to queue setup: ${message}`,
            }),
          },
        }),
        this.prisma.workflow.update({
          where: { id: execution.workflowId },
          data: { status: 'FAILURE' },
        }),
      ]);
      throw new AppError('Failed to queue SDLC setup', 503);
    }
    return { executionId: execution.id, status: execution.status };
  }

  async retrySetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution> {
    const repo = await this.requireRepositoryRole(actor, repoId, true);
    await sdlcVcs.requireCapabilities(actor, repoId, [...BASELINE_CAPABILITIES]);
    if (!repo.sdlcSetupExecutionId) {
      return this.setupRepository(actor, repoId);
    }
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: repo.sdlcSetupExecutionId },
      include: { workflow: { select: { id: true, status: true } } },
    });
    if (!execution) {
      return this.setupRepository(actor, repoId);
    }
    if (['NEW', 'PENDING', 'RUNNING', 'SCHEDULED'].includes(execution.status)) {
      throw new AppError('SDLC setup is already running', 409);
    }
    if (execution.status === 'SUCCESS') {
      return { executionId: execution.id, status: execution.status };
    }

    let context: Record<string, unknown> = {};
    try {
      context = execution.context ? (JSON.parse(execution.context) as Record<string, unknown>) : {};
    } catch {
      context = {};
    }
    delete context.error;
    delete context.currentBaselineKind;
    delete context.sessionId;
    delete context.admissionPermitId;
    context.phase = 'QUEUED';
    context.repoId = repoId;
    context.channelId = repo.channelId;
    await this.prisma.$transaction([
      this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'PENDING', context: JSON.stringify(context), output: null },
      }),
      this.prisma.workflow.update({
        where: { id: execution.workflow.id },
        data: { status: 'PENDING' },
      }),
    ]);
    try {
      await sdlcQueue.enqueueSetup(execution.id, repoId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureContext = {
        ...context,
        phase: 'PARTIALLY_FAILED',
        error: `Failed to queue setup retry: ${message}`,
      };
      await this.prisma.$transaction([
        this.prisma.workflowExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILURE',
            context: JSON.stringify(failureContext),
            output: JSON.stringify({ error: failureContext.error }),
          },
        }),
        this.prisma.workflow.update({
          where: { id: execution.workflow.id },
          data: { status: 'FAILURE' },
        }),
      ]);
      throw new AppError('Failed to queue SDLC setup retry', 503);
    }
    return { executionId: execution.id, status: 'PENDING' };
  }

  async refreshSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution> {
    const repo = await this.requireRepositoryRole(actor, repoId, true);
    await sdlcVcs.requireCapabilities(actor, repoId, [...BASELINE_CAPABILITIES]);
    const context = JSON.stringify({
      repoId,
      channelId: repo.channelId,
      phase: 'QUEUED',
      refreshExisting: true,
      completedBaselineKinds: [],
      reconciledBaselineKinds: [],
    });
    const execution = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      const lockedRepo = await tx.repo.findUnique({
        where: { id: repoId },
        select: { sdlcSetupExecutionId: true },
      });
      if (lockedRepo?.sdlcSetupExecutionId) {
        const active = await tx.workflowExecution.findFirst({
          where: {
            id: lockedRepo.sdlcSetupExecutionId,
            status: { in: ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'] },
          },
          select: { id: true },
        });
        if (active) throw new AppError('Repo Knowledge generation is already running', 409);
      }
      const workflow = await tx.workflow.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowName: `SDLC knowledge refresh: ${repo.name}`,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context,
          metadata: JSON.stringify({ repoId, projectId: repo.projectId, refreshExisting: true }),
        },
      });
      const created = await tx.workflowExecution.create({
        data: {
          workspaceId: actor.workspaceId,
          workflowId: workflow.id,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context,
          createdBy: actor.userId,
        },
      });
      await tx.repo.update({
        where: { id: repoId },
        data: { sdlcSetupExecutionId: created.id },
      });
      return created;
    });
    try {
      await sdlcQueue.enqueueSetup(execution.id, repoId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.$transaction([
        this.prisma.workflowExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILURE',
            context: JSON.stringify({
              ...JSON.parse(context),
              phase: 'PARTIALLY_FAILED',
              error: `Failed to queue Repo Knowledge refresh: ${message}`,
            }),
          },
        }),
        this.prisma.workflow.update({
          where: { id: execution.workflowId },
          data: { status: 'FAILURE' },
        }),
      ]);
      throw new AppError('Failed to queue Repo Knowledge refresh', 503);
    }
    return { executionId: execution.id, status: execution.status };
  }

  async getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string
  ): Promise<SdlcRepositoryRunContext> {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    const agentContext = await sdlcAgentContext.build(actor, repo.id, {
      operation: 'interactive',
      conversationId,
    });
    return {
      repoId: repo.id,
      name: repo.name,
      url: sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url).cloneUrl,
      baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      agentContext,
    };
  }

  async listRepositoryRunContexts(
    actor: SdlcActor,
    query = '',
    limit = 20
  ): Promise<SdlcRepositoryRunContext[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const trimmedQuery = query.trim();
    const memberships = await this.prisma.sdlcEntityLink.findMany({
      where: {
        workspaceId: actor.workspaceId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        channel: { participants: { some: { userId: actor.userId } } },
      },
      select: { targetId: true },
    });
    const repoIds = [...new Set(memberships.map((membership) => membership.targetId))];
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
      select: { id: true, name: true, canonicalUrl: true, baseBranch: true },
    });

    return repos.flatMap((repo) => {
      try {
        return [
          {
            repoId: repo.id,
            name: repo.name,
            url: sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || '').cloneUrl,
            baseBranch: requireSdlcBaseBranch(repo.baseBranch),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async cancelSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution> {
    const repo = await this.requireRepositoryRole(actor, repoId, true);
    if (!repo.sdlcSetupExecutionId) {
      throw new AppError('SDLC setup has not started', 409);
    }
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: repo.sdlcSetupExecutionId },
      include: { workflow: { select: { id: true, status: true } } },
    });
    if (!execution) throw new AppError('SDLC setup execution not found', 404);
    if (execution.status === 'SUCCESS') {
      throw new AppError('Completed SDLC setup cannot be cancelled', 409);
    }
    if (execution.status === 'FAILURE' || execution.status === 'CANCELLED') {
      return { executionId: execution.id, status: execution.status };
    }

    const context = this.parseJsonRecord(execution.context);
    const sessionId = typeof context.sessionId === 'string' ? context.sessionId : undefined;
    const cancelledContext = {
      ...context,
      phase: 'CANCELLED',
      error: sessionId
        ? 'Setup cancelled by user.'
        : 'Setup cancelled locally before a Claw session became available.',
    };
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowExecution.updateMany({
        where: {
          id: execution.id,
          status: { in: ['NEW', 'PENDING', 'RUNNING', 'SCHEDULED'] },
        },
        data: {
          status: 'CANCELLED',
          context: JSON.stringify(cancelledContext),
          output: JSON.stringify({ error: cancelledContext.error }),
        },
      });
      if (updated.count === 0) return false;
      await tx.workflow.update({
        where: { id: execution.workflow.id },
        data: { status: 'CANCELLED' },
      });
      return true;
    });
    if (!cancelled) {
      const latest = await this.prisma.workflowExecution.findUnique({
        where: { id: execution.id },
        select: { status: true },
      });
      if (latest?.status === 'SUCCESS') {
        throw new AppError('Completed SDLC setup cannot be cancelled', 409);
      }
      return { executionId: execution.id, status: latest?.status || execution.status };
    }

    const admissionPermitId =
      typeof context.admissionPermitId === 'string' ? context.admissionPermitId : undefined;

    if (sessionId) {
      const cancellation = await cancelS2SClawRun(sessionId, execution.createdBy || actor.userId);
      if (!cancellation.success) {
        const error = cancellation.error || 'Failed to cancel Claw run';
        const failureContext = {
          ...context,
          phase: 'PARTIALLY_FAILED',
          error: `Cloud cancellation failed: ${error}`,
        };
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.workflowExecution.updateMany({
            where: { id: execution.id, status: 'CANCELLED' },
            data: {
              status: 'FAILURE',
              context: JSON.stringify(failureContext),
              output: JSON.stringify({ error: failureContext.error }),
            },
          });
          if (updated.count > 0) {
            await tx.workflow.update({
              where: { id: execution.workflow.id },
              data: { status: 'FAILURE' },
            });
          }
        });
        throw new AppError(error, 502);
      }
    }
    await sdlcAdmission.release(admissionPermitId);
    return { executionId: execution.id, status: 'CANCELLED' };
  }

  async getExecutionDebug(
    actor: SdlcActor,
    repoId: string,
    executionId: string
  ): Promise<ClawDebugArtifactBundle> {
    await this.requireRepositoryRole(actor, repoId, true);
    const execution = await this.prisma.workflowExecution.findFirst({
      where: { id: executionId, workspaceId: actor.workspaceId },
      select: { context: true, createdBy: true },
    });
    const context = this.parseJsonRecord(execution?.context);
    if (!execution?.createdBy || context.repoId !== repoId) {
      throw new AppError('SDLC execution not found', 404);
    }
    const conversationId = context.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) {
      throw new AppError('Claw conversation is not available yet', 409);
    }
    const result = await getClawDebugArtifacts(
      { userId: execution.createdBy },
      conversationId,
      'sdlc-agent'
    );
    return result.data;
  }

  async createArtifactFromClaw(
    actor: SdlcActor,
    input: CreateSdlcClawArtifactInput
  ): Promise<SdlcArtifact> {
    const repo = await this.requireRepositoryRole(
      actor,
      input.repoId,
      false,
      (input.folderId ? await this.hubOf('canvasFolder', input.folderId) : undefined) ??
        (input.setupExecutionId ? await this.hubOfExecution(input.setupExecutionId) : undefined) ??
        input.channelId
    );
    if (!repo?.channelId || !repo.projectId) {
      throw new AppError('SDLC repository not found', 404);
    }
    if (input.kind === 'BASELINE') {
      await sdlcVcs.requireCapabilities(actor, input.repoId, [...BASELINE_CAPABILITIES]);
    }

    const folder = input.folderId
      ? await this.prisma.canvasFolder.findFirst({
          where: { id: input.folderId, channelId: repo.channelId },
          select: { id: true },
        })
      : await this.prisma.canvasFolder.findFirst({
          where: { channelId: repo.channelId, name: 'Baseline' },
          select: { id: true },
        });
    if (!folder) throw new AppError('Artifact type folder not found', 409);

    let baselineGenerationCommit: string | null = null;
    if (input.kind === 'BASELINE') {
      const execution = await this.prisma.workflowExecution.findFirst({
        where: {
          id: input.setupExecutionId,
          workspaceId: actor.workspaceId,
          workflowType: 'SDLC_SETUP',
          status: 'RUNNING',
          createdBy: actor.userId,
        },
        select: { id: true, context: true },
      });
      if (!execution) throw new AppError('Active SDLC setup execution not found', 409);
      if (input.workflowExecutionId !== input.setupExecutionId) {
        throw new AppError(
          'Baseline workflow execution binding does not match setup execution',
          403
        );
      }
      const executionContext = this.parseJsonRecord(execution.context);
      if (executionContext.repoId !== repo.id) {
        throw new AppError('SDLC setup execution does not belong to this repository', 403);
      }
      baselineGenerationCommit =
        typeof executionContext.generationCommit === 'string'
          ? executionContext.generationCommit
          : null;
      const existing = await this.findSdlcCanvas(
        repo.channelId,
        input.baselineKind!,
        input.setupExecutionId!
      );
      if (existing) {
        return {
          canvasId: existing.id,
          viewAccessId: existing.viewAccessId ?? undefined,
          url: `/chat/canvas/${existing.id}`,
          kind: 'BASELINE',
        };
      }
    }

    if (input.trackId) {
      const inHub =
        Boolean(repo.channelId) &&
        (await isTrackInChannel(this.prisma, input.trackId, repo.channelId!));
      if (!inHub) throw new AppError('SDLC track not found for this repository', 404);
    }

    let artifactMarkdown = input.markdown;
    let artifactGenerationCommit: string | undefined;
    let artifactSourceReferences: SdlcSourceReference[] = [];
    const citesRepository =
      (input.sourceReferences?.length ?? 0) > 0 || input.markdown.includes('[[source:');
    if (citesRepository) {
      const pinnedCommit =
        input.kind === 'BASELINE'
          ? baselineGenerationCommit
          : await sdlcVcs.resolveBaseBranchHead(repo.id);
      if (!pinnedCommit) {
        throw new AppError('Structured SDLC references require a pinned artifact execution', 409);
      }
      artifactGenerationCommit = pinnedCommit;
      const resolved = await this.resolveSourceReferences({
        repoId: repo.id,
        repositoryUrl: repo.canonicalUrl || repo.url,
        generationCommit: pinnedCommit,
        markdown: input.markdown,
        sourceReferences: input.sourceReferences,
      });
      artifactMarkdown = resolved.markdown;
      artifactSourceReferences = resolved.sourceReferences;
    }

    const content = await convertMarkdownToBlockNote(artifactMarkdown);
    const artifact = await commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
          const viewAccessId = randomUUID();
          const canvas = await tx.canvas.create({
            data: {
              workspaceId: actor.workspaceId,
              title: input.title,
              content: content as unknown as Prisma.InputJsonValue,
              channelId: repo.channelId,
              folderId: folder.id,
              projectId: repo.projectId,
              createdBy: actor.userId,
              lastEditedBy: actor.userId,
              lastEditedAt: new Date(),
              viewAccessId,
              visibility: CanvasVisibility.PRIVATE,
              isCollaborative: true,
              metadata: {} as Prisma.InputJsonValue,
              participants: {
                create: sdlcChannelCanvasParticipant(actor.workspaceId, repo.channelId),
              },
            },
          });
          if (input.kind !== 'BASELINE' && input.trackId) {
            await tx.sdlcEntityLink.create({
              data: {
                workspaceId: actor.workspaceId,
                channelId: repo.channelId,
                sourceType: 'TRACK',
                sourceId: input.trackId,
                targetType: 'CANVAS',
                targetId: canvas.id,
                relationType: 'TRACK_ITEM',
                createdBy: actor.userId,
              },
            });
          }
          await tx.sdlcArtifact.create({
            data: {
              workspaceId: actor.workspaceId,
              repoId: repo.id,
              artifactId: canvas.id,
              artifactType:
                input.kind === 'BASELINE'
                  ? canvasTypeForSdlcArtifact(input.baselineKind)
                  : 'DEFAULT',
              artifactStatus: 'ACTIVE',
              ...(input.kind === 'BASELINE' && input.workflowExecutionId
                ? { workflowExecutionId: input.workflowExecutionId }
                : {}),
              ...(artifactGenerationCommit ? { generationCommit: artifactGenerationCommit } : {}),
              sourceReferences: stringifySdlcSourceReferences(artifactSourceReferences),
              createdBy: actor.userId,
            },
          });

          const relatedIds = Array.from(
            new Set((input.relatedCanvasIds ?? []).filter(id => id !== canvas.id)),
          );
          if (relatedIds.length > 0) {
            const validRelated = await tx.canvas.findMany({
              where: { id: { in: relatedIds }, channelId: repo.channelId! },
              select: { id: true },
            });
            for (const related of validRelated) {
              await tx.sdlcEntityLink.create({
                data: {
                  workspaceId: actor.workspaceId,
                  channelId: repo.channelId,
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
              kind: input.kind,
            },
            canvasId: canvas.id,
            content,
          };
        }),
      syncToYSweet
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

  async updateBaselineDraftFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcBaselineDraftInput
  ): Promise<SdlcArtifact> {
    const repo = await this.requireRepositoryRole(
      actor,
      input.repoId,
      false,
      await this.hubOfExecution(input.setupExecutionId)
    );
    if (!repo?.channelId || !repo.projectId) {
      throw new AppError('SDLC repository not found', 404);
    }
    await sdlcVcs.requireCapabilities(actor, input.repoId, [...BASELINE_CAPABILITIES]);
    if (input.workflowExecutionId !== input.setupExecutionId) {
      throw new AppError('Baseline workflow execution binding does not match setup execution', 403);
    }
    const definition = BASELINE_DEFINITIONS.find((item) => item.kind === input.baselineKind);
    if (!definition) throw new AppError('Unsupported SDLC baseline kind', 400);
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { channelId: repo.channelId, name: 'Baseline' },
      select: { id: true },
    });
    if (!folder) throw new AppError('Baseline folder not found', 409);

    const setupExecution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: input.setupExecutionId,
        workspaceId: actor.workspaceId,
        workflowType: 'SDLC_SETUP',
        status: 'RUNNING',
        createdBy: actor.userId,
      },
      select: { context: true },
    });
    if (!setupExecution) throw new AppError('Active SDLC setup execution not found', 409);
    const setupContext = this.parseJsonRecord(setupExecution.context);
    if (setupContext.repoId !== repo.id) {
      throw new AppError('SDLC setup execution does not belong to this repository', 403);
    }
    const generationCommit =
      typeof setupContext.generationCommit === 'string' ? setupContext.generationCommit : null;
    if (!generationCommit) {
      throw new AppError('SDLC setup generation commit is unavailable', 409);
    }
    let canonicalSourceReferences: SdlcSourceReference[] = [];
    if (input.action === 'upsert_section' && input.markdown) {
      const resolved = await this.resolveSourceReferences({
        repoId: repo.id,
        repositoryUrl: repo.canonicalUrl || repo.url,
        generationCommit,
        markdown: input.markdown,
        sourceReferences: input.sourceReferences,
      });
      input = { ...input, markdown: resolved.markdown };
      canonicalSourceReferences = resolved.sourceReferences;
    }

    return commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "public"."workflow_executions" WHERE "id" = ${input.setupExecutionId} FOR UPDATE`;
          const execution = await tx.workflowExecution.findFirst({
            where: {
              id: input.setupExecutionId,
              workspaceId: actor.workspaceId,
              workflowType: 'SDLC_SETUP',
              status: 'RUNNING',
              createdBy: actor.userId,
            },
            select: { context: true },
          });
          if (!execution) throw new AppError('Active SDLC setup execution not found', 409);
          const executionContext = this.parseJsonRecord(execution.context);
          if (executionContext.repoId !== repo.id) {
            throw new AppError('SDLC setup execution does not belong to this repository', 403);
          }

          const candidates = await tx.canvas.findMany({
            where: {
              channelId: repo.channelId,
              sdlcArtifact: { is: { artifactType: input.baselineKind } },
            },
            select: {
              id: true,
              title: true,
              viewAccessId: true,
              sdlcArtifact: { select: { artifactStatus: true } },
              metadata: true,
              content: true,
            },
          });
          const candidateEntities = candidates.length
            ? await tx.sdlcArtifact.findMany({
                where: {
                  artifactId: { in: candidates.map((candidate) => candidate.id) },
                },
                select: { artifactId: true, workflowExecutionId: true },
              })
            : [];
          const executionIdByCanvasId = new Map(
            candidateEntities.map((entity) => [entity.artifactId, entity.workflowExecutionId])
          );
          let canvas = candidates.find(
            (candidate) => executionIdByCanvasId.get(candidate.id) === input.setupExecutionId
          );

          if (!canvas) {
            if (input.action === 'finalize') {
              throw new AppError('Begin the baseline draft before finalizing it', 409);
            }
            const metadata: Record<string, unknown> = {
              draftSections: {},
            };
            const nextMetadata =
              input.action === 'upsert_section'
                ? this.applyValidatedDraftSection(
                    definition,
                    metadata,
                    input,
                    canonicalSourceReferences
                  )
                : metadata;
            const markdown = buildBaselineDraftMarkdown(
              input.title,
              input.baselineKind,
              nextMetadata
            );
            const content = await convertMarkdownToBlockNote(markdown);
            const created = await tx.canvas.create({
              data: {
                workspaceId: actor.workspaceId,
                title: input.title,
                content: content as unknown as Prisma.InputJsonValue,
                channelId: repo.channelId,
                folderId: folder.id,
                projectId: repo.projectId,
                createdBy: actor.userId,
                lastEditedBy: actor.userId,
                lastEditedAt: new Date(),
                viewAccessId: randomUUID(),
                visibility: CanvasVisibility.PRIVATE,
                isCollaborative: true,
                metadata: nextMetadata as Prisma.InputJsonValue,
                ...(executionContext.refreshExisting === true
                  ? {}
                  : {
                      participants: {
                        create: sdlcChannelCanvasParticipant(actor.workspaceId, repo.channelId),
                      },
                    }),
              },
              select: {
                id: true,
                title: true,
                viewAccessId: true,
                sdlcArtifact: { select: { artifactStatus: true } },
                metadata: true,
                content: true,
              },
            });
            await tx.sdlcArtifact.create({
              data: {
                workspaceId: actor.workspaceId,
                repoId: repo.id,
                artifactId: created.id,
                artifactType: input.baselineKind,
                artifactStatus:
                  executionContext.refreshExisting === true ? 'REFRESH_CANDIDATE' : 'DRAFT',
                workflowExecutionId: input.workflowExecutionId,
                generationCommit,
                createdBy: actor.userId,
              },
            });
            canvas = created;
          } else if (canvas.sdlcArtifact?.artifactStatus !== 'ACTIVE') {
            const metadata = canvas.metadata as Record<string, unknown>;
            if (input.action === 'upsert_section') {
              const nextMetadata = this.applyValidatedDraftSection(
                definition,
                metadata,
                input,
                canonicalSourceReferences
              );
              const markdown = buildBaselineDraftMarkdown(
                input.title,
                input.baselineKind,
                nextMetadata
              );
              const content = await convertMarkdownToBlockNote(markdown);
              canvas = await tx.canvas.update({
                where: { id: canvas.id },
                data: {
                  title: input.title,
                  content: content as unknown as Prisma.InputJsonValue,
                  metadata: nextMetadata as Prisma.InputJsonValue,
                  lastEditedBy: actor.userId,
                  lastEditedAt: new Date(),
                },
                select: {
                  id: true,
                  title: true,
                  viewAccessId: true,
                  sdlcArtifact: { select: { artifactStatus: true } },
                  metadata: true,
                  content: true,
                },
              });
            } else if (input.action === 'finalize') {
              const missing = baselineDraftMissingSections(input.baselineKind, metadata);
              if (missing.length > 0) {
                throw new AppError(
                  `Cannot finalize baseline; missing sections: ${missing.join(', ')}`,
                  409
                );
              }
              const markdown = buildBaselineDraftMarkdown(
                input.title,
                input.baselineKind,
                metadata,
                true
              );
              const content = await convertMarkdownToBlockNote(markdown);
              const finalSourceReferences = finalizeBaselineDraft(input.baselineKind, metadata);
              const finalizedCandidate = await tx.canvas.update({
                where: { id: canvas.id },
                data: {
                  title: input.title,
                  content: content as unknown as Prisma.InputJsonValue,
                  metadata: {} as Prisma.InputJsonValue,
                  lastEditedBy: actor.userId,
                  lastEditedAt: new Date(),
                },
                select: {
                  id: true,
                  title: true,
                  viewAccessId: true,
                  sdlcArtifact: { select: { artifactStatus: true } },
                  metadata: true,
                  content: true,
                },
              });
              canvas = finalizedCandidate;
              await tx.sdlcArtifact.updateMany({
                where: { artifactId: finalizedCandidate.id },
                data: {
                  sourceReferences: stringifySdlcSourceReferences(finalSourceReferences),
                },
              });

              if (executionContext.refreshExisting === true) {
                const stagedCanvasId = finalizedCandidate.id;
                let canonical = candidates.find(
                  (candidate) =>
                    candidate.id !== finalizedCandidate.id &&
                    candidate.sdlcArtifact?.artifactStatus === 'ACTIVE'
                );

                if (canonical) {
                  await tx.$queryRaw`SELECT "id" FROM "public"."canvases" WHERE "id" = ${canonical.id} FOR UPDATE`;
                  canonical = await tx.canvas.findUniqueOrThrow({
                    where: { id: canonical.id },
                    select: {
                      id: true,
                      title: true,
                      viewAccessId: true,
                      sdlcArtifact: { select: { artifactStatus: true } },
                      metadata: true,
                      content: true,
                    },
                  });
                  const currentMarkdown = (
                    await convertBlockNoteToMarkdown(canonical.content as unknown[])
                  ).trim();
                  if (!baselineRefreshChanged(currentMarkdown, markdown)) {
                    await tx.sdlcArtifact.deleteMany({
                      where: { artifactId: finalizedCandidate.id },
                    });
                    await tx.canvas.delete({ where: { id: finalizedCandidate.id } });
                    canvas = canonical;
                  } else {
                    const now = new Date();
                    const oldHash = createHash('sha256').update(currentMarkdown).digest('hex');
                    const newHash = createHash('sha256').update(markdown.trim()).digest('hex');
                    await tx.canvasVersion.upsert({
                      where: {
                        canvasId_contentHash: { canvasId: canonical.id, contentHash: oldHash },
                      },
                      create: {
                        workspaceId: actor.workspaceId,
                        canvasId: canonical.id,
                        name: 'Before SDLC knowledge refresh',
                        content: canonical.content as Prisma.InputJsonValue,
                        contentHash: oldHash,
                        createdBy: actor.userId,
                      },
                      update: { updatedAt: now },
                    });
                    await tx.canvasVersion.upsert({
                      where: {
                        canvasId_contentHash: { canvasId: canonical.id, contentHash: newHash },
                      },
                      create: {
                        workspaceId: actor.workspaceId,
                        canvasId: canonical.id,
                        name: 'SDLC knowledge refresh',
                        content: content as unknown as Prisma.InputJsonValue,
                        contentHash: newHash,
                        createdBy: actor.userId,
                      },
                      update: { updatedAt: now },
                    });
                    canvas = await tx.canvas.update({
                      where: { id: canonical.id },
                      data: {
                        title: input.title,
                        content: content as unknown as Prisma.InputJsonValue,
                        metadata: {} as Prisma.InputJsonValue,
                        lastEditedBy: actor.userId,
                        lastEditedAt: now,
                      },
                      select: {
                        id: true,
                        title: true,
                        viewAccessId: true,
                        sdlcArtifact: { select: { artifactStatus: true } },
                        metadata: true,
                        content: true,
                      },
                    });
                    await tx.sdlcArtifact.upsert({
                      where: {
                        artifactId: canonical.id,
                      },
                      create: {
                        workspaceId: actor.workspaceId,
                        repoId: repo.id,
                        artifactId: canonical.id,
                        artifactType: input.baselineKind,
                        artifactStatus: 'ACTIVE',
                        workflowExecutionId: input.workflowExecutionId,
                        generationCommit,
                        sourceReferences: stringifySdlcSourceReferences(finalSourceReferences),
                        createdBy: actor.userId,
                      },
                      update: {
                        artifactStatus: 'ACTIVE',
                        workflowExecutionId: input.workflowExecutionId,
                        generationCommit,
                        sourceReferences: stringifySdlcSourceReferences(finalSourceReferences),
                      },
                    });
                    await tx.sdlcArtifact.deleteMany({
                      where: { artifactId: stagedCanvasId },
                    });
                    await tx.canvas.delete({ where: { id: stagedCanvasId } });
                  }
                } else {
                  await tx.sdlcArtifact.update({
                    where: { artifactId: finalizedCandidate.id },
                    data: { artifactStatus: 'ACTIVE' },
                  });
                  canvas = await tx.canvas.findUniqueOrThrow({
                    where: { id: finalizedCandidate.id },
                    select: {
                      id: true,
                      title: true,
                      viewAccessId: true,
                      sdlcArtifact: { select: { artifactStatus: true } },
                      metadata: true,
                      content: true,
                    },
                  });
                  await tx.canvasParticipant.create({
                    data: {
                      canvasId: canvas.id,
                      ...sdlcChannelCanvasParticipant(actor.workspaceId, repo.channelId),
                    },
                  });
                }

                const reconciled = Array.isArray(executionContext.reconciledBaselineKinds)
                  ? executionContext.reconciledBaselineKinds.filter(
                      (value): value is string => typeof value === 'string'
                    )
                  : [];
                await tx.workflowExecution.update({
                  where: { id: input.setupExecutionId },
                  data: {
                    context: JSON.stringify({
                      ...executionContext,
                      reconciledBaselineKinds: [...new Set([...reconciled, input.baselineKind])],
                    }),
                  },
                });
              }
            }
          }

          if (!canvas) throw new AppError('Baseline draft is unavailable', 409);
          return {
            artifact: {
              canvasId: canvas.id,
              viewAccessId: canvas.viewAccessId ?? undefined,
              url: `/chat/canvas/${canvas.viewAccessId ?? canvas.id}`,
              kind: 'BASELINE' as const,
            },
            canvasId: canvas.id,
            content: canvas.content as unknown as BlockNoteBlock[],
          };
        }),
      syncToYSweet
    );
  }

  async updateArtifactFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcClawArtifactInput
  ): Promise<SdlcArtifact> {
    const repo = await this.requireRepositoryRole(
      actor,
      input.repoId,
      false,
      await this.hubOf('canvas', input.canvasId)
    );
    if (!repo.channelId || !repo.projectId) throw new AppError('SDLC repository not found', 404);
    const existing = await this.prisma.canvas.findFirst({
      where: {
        id: input.canvasId,
        channelId: repo.channelId,
        sdlcArtifact: { isNot: null },
      },
      select: { id: true, viewAccessId: true, title: true },
    });
    if (!existing) throw new AppError('SDLC artifact not found', 404);
    const existingEntity = await this.prisma.sdlcArtifact.findUnique({
      where: { artifactId: existing.id },
      select: { generationCommit: true },
    });
    const generationCommit =
      existingEntity?.generationCommit ?? (await sdlcVcs.resolveBaseBranchHead(repo.id));
    const resolved = await this.resolveSourceReferences({
      repoId: repo.id,
      repositoryUrl: repo.canonicalUrl || repo.url,
      generationCommit,
      markdown: input.markdown,
      sourceReferences: input.sourceReferences,
    });
    const content = await convertMarkdownToBlockNote(resolved.markdown);
    return commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
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
              repoId: repo.id,
              artifactId: existing.id,
              artifactType: 'DEFAULT',
              generationCommit,
              sourceReferences: stringifySdlcSourceReferences(resolved.sourceReferences),
              createdBy: actor.userId,
            },
            update: {
              generationCommit,
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
        }),
      syncToYSweet
    );
  }

  async linkContext(
    actor: SdlcActor,
    repoId: string,
    input: CreateSdlcLinkInput,
    channelId?: string
  ): Promise<SdlcLink> {
    if (input.relationType === 'DISCUSSION') {
      throw new AppError('SDLC discussions must be created with their conversation', 400);
    }
    const repo = await this.requireRepositoryRole(actor, repoId, false, channelId);
    await this.requireLinkSource(repoId, repo.channelId!, input.sourceType, input.sourceId);
    await this.requireAccessibleEntity(actor, input.targetType, input.targetId);
    try {
      const link = await this.prisma.sdlcEntityLink.create({
        data: {
          ...input,
          workspaceId: actor.workspaceId,
          channelId: repo.channelId,
          createdBy: actor.userId,
        },
      });
      // Propagate the source artifact's track onto the ticket so the ticket shows
      // under the same track (same TRACK_ITEM entity link we use for PRDs/Tech Docs).
      if (input.targetType === 'TICKET' && input.sourceType === 'CANVAS') {
        const trackLink = await this.prisma.sdlcEntityLink.findFirst({
          where: {
            channelId: repo.channelId,
            sourceType: 'TRACK',
            targetType: 'CANVAS',
            targetId: input.sourceId,
            relationType: 'TRACK_ITEM',
          },
          select: { sourceId: true },
        });
        if (trackLink) {
          try {
            await this.prisma.sdlcEntityLink.create({
              data: {
                workspaceId: actor.workspaceId,
                channelId: repo.channelId,
                sourceType: 'TRACK',
                sourceId: trackLink.sourceId,
                targetType: 'TICKET',
                targetId: input.targetId,
                relationType: 'TRACK_ITEM',
                createdBy: actor.userId,
              },
            });
          } catch (trackError) {
            // The ticket may already belong to the track; the unique constraint
            // makes this idempotent. Any other error must not fail the primary link.
            if (
              !(
                trackError instanceof Prisma.PrismaClientKnownRequestError &&
                trackError.code === 'P2002'
              )
            ) {
              throw trackError;
            }
          }
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

  async listTracks(actor: SdlcActor, repoId: string, channelId?: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false, channelId);
    // Tracks carry no scope column; the CHANNEL -> TRACK edges name the hub's tracks.
    const trackIds = repo.channelId ? await trackIdsForChannel(this.prisma, repo.channelId) : [];
    return this.prisma.sdlcTrack.findMany({
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
    });
  }

  async createTrack(actor: SdlcActor, input: CreateSdlcTrackInput) {
    const repo = await this.requireRepositoryRole(actor, input.repoId, false, input.channelId);
    if (!repo.channelId) throw new AppError('SDLC repository not found', 404);
    const channelId = repo.channelId;
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

  async listArtifactTypes(actor: SdlcActor, repoId: string, channelId?: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false, channelId);
    if (!repo?.channelId) throw new AppError('SDLC repository not found', 404);
    return this.prisma.canvasFolder.findMany({
      where: { channelId: repo.channelId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    });
  }

  async createArtifactType(actor: SdlcActor, repoId: string, name: string, channelId?: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false, channelId);
    if (!repo?.channelId || !repo.projectId) {
      throw new AppError('SDLC repository not found', 404);
    }
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('Artifact type name is required', 400);
    const existing = await this.prisma.canvasFolder.findFirst({
      where: { channelId: repo.channelId, name: trimmed },
      select: { id: true },
    });
    if (existing) throw new AppError('An artifact type with this name already exists', 409);
    return this.prisma.canvasFolder.create({
      data: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        projectId: repo.projectId,
        channelId: repo.channelId,
        name: trimmed,
        createdBy: actor.userId,
      },
      select: { id: true, name: true },
    });
  }

  async renameArtifactType(actor: SdlcActor, repoId: string, folderId: string, name: string) {
    const repo = await this.requireRepositoryRole(
      actor,
      repoId,
      false,
      await this.hubOf('canvasFolder', folderId)
    );
    if (!repo?.channelId) throw new AppError('SDLC repository not found', 404);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('Artifact type name is required', 400);
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { id: folderId, channelId: repo.channelId },
      select: { id: true, name: true },
    });
    if (!folder) throw new AppError('Artifact type not found', 404);
    if (folder.name === 'Baseline') {
      throw new AppError('Repo Knowledge cannot be renamed', 400);
    }
    const clash = await this.prisma.canvasFolder.findFirst({
      where: { channelId: repo.channelId, name: trimmed, id: { not: folderId } },
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

  private async requireProjectBoardAccess(
    tx: TransactionClient,
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

  private applyValidatedDraftSection(
    definition: (typeof BASELINE_DEFINITIONS)[number],
    metadata: Record<string, unknown>,
    input: UpdateSdlcBaselineDraftInput,
    sourceReferences: SdlcSourceReference[] = []
  ): Record<string, unknown> {
    const section = definition.sections.find((item) => item.key === input.sectionKey);
    if (!section) {
      throw new AppError(
        `Unknown ${definition.kind} section ${input.sectionKey || '(missing)'}`,
        400
      );
    }
    if (!input.markdown) {
      throw new AppError('Baseline section markdown is required', 400);
    }
    return applyBaselineDraftSection(metadata, {
      sectionKey: section.key,
      sectionTitle: section.title,
      markdown: input.markdown,
      sourceReferences,
    });
  }

  private async resolveSourceReferences(input: {
    repoId: string;
    repositoryUrl: string;
    generationCommit: string;
    markdown: string;
    sourceReferences?: UpdateSdlcBaselineDraftInput['sourceReferences'];
  }): Promise<{ markdown: string; sourceReferences: SdlcSourceReference[] }> {
    const requested = input.sourceReferences ?? [];
    await Promise.all([
      sdlcVcs.verifySourcePaths(input.repoId, input.generationCommit, [
        ...new Set(requested.map((reference) => reference.path)),
      ]),
      sdlcVcs.verifySourceRanges(input.repoId, input.generationCommit, requested),
    ]);
    return {
      markdown: resolveSdlcSourceReferenceTokens({
        markdown: input.markdown,
        repositoryUrl: input.repositoryUrl,
        commitSha: input.generationCommit,
        references: requested,
      }),
      sourceReferences: requested.map((reference) => ({
        ...reference,
        commitSha: input.generationCommit,
      })),
    };
  }

  /** Gate for hub-scoped work: artifact types, artifacts, links, tracks, membership. */
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

  private async hubOfExecution(executionId: string): Promise<string | undefined> {
    const row = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { context: true },
    });
    const channelId = this.parseJsonRecord(row?.context).channelId;
    return typeof channelId === 'string' && channelId ? channelId : undefined;
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

  private parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private async findSdlcCanvas(
    channelId: string,
    artifactType: string,
    workflowExecutionId: string
  ): Promise<{ id: string; viewAccessId: string | null } | null> {
    const entity = await this.prisma.sdlcArtifact.findFirst({
      where: { workflowExecutionId, artifactType, canvas: { is: { channelId } } },
      select: { artifactId: true },
    });
    if (!entity) return null;
    return this.prisma.canvas.findFirst({
      where: { id: entity.artifactId, channelId },
      select: { id: true, viewAccessId: true },
    });
  }

  private async requireLinkSource(
    repoId: string,
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
    if (!exists) throw new AppError(`Invalid ${type} source for repository ${repoId}`, 400);
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
