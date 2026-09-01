import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  AccessType,
  CanvasVisibility,
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  WorkspaceRole,
  normalizeChannelName,
  validateChannelName,
  canvasTypeForSdlcArtifact,
  stringifySdlcSourceReferences,
  type AttachSdlcRepositoryInput,
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
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { isCanvasContentEmpty } from '@xyne/shared';
import { buildHandleMap, deriveOps, parseLabelledMarkdown } from '@/services/canvas/blockLabels';
import { deriveDiffOps } from '@/services/canvas/blockDiff';
import { createBlockRenderer } from '@/services/canvas/blockRender';
import { createSuggestionBatch } from '@/services/canvas/suggestions';
import { getReadReceipt } from '@/services/canvas/readReceipt';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import {
  applyBaselineDraftSection,
  baselineDraftMissingSections,
  buildBaselineDraftMarkdown,
  baselineRefreshChanged,
  finalizeBaselineDraft,
} from './sdlcBaselineDraft';
import { commitAndSyncCanvasArtifact } from './sdlcBaselineCanvasSync';
import { sdlcChannelCanvasParticipant } from './sdlcCanvasAccess';
import { BASELINE_CAPABILITIES } from './sdlcProgressiveGate';
import type {
  SdlcActor,
  SdlcArtifact,
  SdlcHub,
  SdlcLink,
  SdlcRepositoryHub,
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

  async attachRepository(
    actor: SdlcActor,
    input: AttachSdlcRepositoryInput
  ): Promise<SdlcRepositoryHub> {
    const parsedRepository = sdlcVcs.parseRepository('GITHUB', input.url);
    const canonicalUrl = parsedRepository.canonicalUrl;
    const name = normalizeChannelName(input.name?.trim() || parsedRepository.name);
    const nameError = validateChannelName(name);
    if (nameError) {
      throw new AppError(nameError, 400);
    }

    try {
      const repository = await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: input.projectId, workspaceId: actor.workspaceId },
          select: { id: true, name: true },
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
          throw new AppError('Repository already has an SDLC hub in this workspace', 409);
        }

        if (await channelRepository.checkDuplicateName(name, actor.workspaceId)) {
          throw new AppError(`Channel with name "${name}" already exists.`, 409);
        }

        const repoId = randomUUID();
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
            projectId: project.id,
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
            projectId: project.id,
            channelId,
            name: folderName,
            createdBy: actor.userId,
          })),
        });

        const repo = await tx.repo.create({
          data: {
            id: repoId,
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
            channelId,
          },
        });

        return {
          id: repo.id,
          name: repo.name,
          url: repo.url,
          canonicalUrl,
          projectId: project.id,
          channelId,
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
        throw new AppError('Repository already has an SDLC hub in this workspace', 409);
      }
      throw error;
    }
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
    const repos = await this.prisma.repo.findMany({
      where: {
        workspaceId: actor.workspaceId,
        channelId: { not: null },
        channel: { participants: { some: { userId: actor.userId } } },
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
    const repo = await this.requireRepositoryRole(actor, input.repoId, false);
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
      const track = await this.prisma.sdlcTrack.findFirst({
        where: { id: input.trackId, repoId: repo.id },
        select: { id: true },
      });
      if (!track) throw new AppError('SDLC track not found for this repository', 404);
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
                repoId: repo.id,
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
                  repoId: repo.id,
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
    const repo = await this.requireRepositoryRole(actor, input.repoId, false);
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
    const repo = await this.requireRepositoryRole(actor, input.repoId, false);
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

    // Suggestion gate (mirrors updateCanvas): updates to a NON-EMPTY PRD/Tech
    // Doc are parked as suggestions for human review instead of overwriting.
    // Labelled markdown gets the full label protocol; unlabelled regenerations
    // fall back to an exact-text block diff. Empty canvases keep direct write.
    const live = await readFromYSweet(existing.id);
    if (!isCanvasContentEmpty(live)) {
      const nextBlocks = content as unknown as BlockNoteBlock[];
      const renderer = await createBlockRenderer([...live, ...nextBlocks]);
      const entries = parseLabelledMarkdown(resolved.markdown);
      const receipt = await getReadReceipt(existing.id, actor.userId);
      const ops = entries.some(e => e.handle !== null || e.isNew)
        ? deriveOps({
            current: live,
            entries,
            handleMap: buildHandleMap(live),
            render: renderer.render,
            ...(receipt ? { seenBlockIds: new Set(receipt.blockIds) } : {}),
          })
        : deriveDiffOps(live, nextBlocks, renderer.render);

      // Title and provenance are not suggestion-managed; keep them current.
      if (input.title) {
        await this.prisma.canvas.update({ where: { id: existing.id }, data: { title: input.title } });
      }
      await this.prisma.sdlcArtifact.upsert({
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

      const created = ops.length
        ? (await createSuggestionBatch({ workspaceId: actor.workspaceId, canvasId: existing.id, ops })).created
        : 0;
      return {
        canvasId: existing.id,
        viewAccessId: existing.viewAccessId ?? undefined,
        url: `/chat/canvas/${existing.viewAccessId ?? existing.id}`,
        parked: true,
        pendingChanges: created,
      };
    }

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
    input: CreateSdlcLinkInput
  ): Promise<SdlcLink> {
    if (input.relationType === 'DISCUSSION') {
      throw new AppError('SDLC discussions must be created with their conversation', 400);
    }
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    await this.requireLinkSource(repoId, repo.channelId!, input.sourceType, input.sourceId);
    await this.requireAccessibleEntity(actor, input.targetType, input.targetId);
    try {
      const link = await this.prisma.sdlcEntityLink.create({
        data: { ...input, workspaceId: actor.workspaceId, repoId, createdBy: actor.userId },
      });
      // Propagate the source artifact's track onto the ticket so the ticket shows
      // under the same track (same TRACK_ITEM entity link we use for PRDs/Tech Docs).
      if (input.targetType === 'TICKET' && input.sourceType === 'CANVAS') {
        const trackLink = await this.prisma.sdlcEntityLink.findFirst({
          where: {
            repoId,
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
                repoId,
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

  async listTracks(actor: SdlcActor, repoId: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    return this.prisma.sdlcTrack.findMany({
      where: { repoId: repo.id },
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
    const repo = await this.requireRepositoryRole(actor, input.repoId, false);
    return this.prisma.sdlcTrack.create({
      data: {
        workspaceId: actor.workspaceId,
        repoId: repo.id,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        status: 'ACTIVE',
        createdBy: actor.userId,
      },
      select: { id: true, name: true, description: true, status: true },
    });
  }

  async listArtifactTypes(actor: SdlcActor, repoId: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    if (!repo?.channelId) throw new AppError('SDLC repository not found', 404);
    return this.prisma.canvasFolder.findMany({
      where: { channelId: repo.channelId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    });
  }

  async createArtifactType(actor: SdlcActor, repoId: string, name: string) {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
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
    const repo = await this.requireRepositoryRole(actor, repoId, false);
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
    await this.requireRepositoryRole(actor, repoId, false);
    const link = await this.prisma.sdlcEntityLink.findFirst({
      where: { id: linkId, repoId, workspaceId: actor.workspaceId },
      select: { relationType: true },
    });
    if (!link) {
      throw new AppError('SDLC relationship not found', 404);
    }
    if (link.relationType === 'DISCUSSION') {
      throw new AppError('Delete the conversation to remove an SDLC discussion', 400);
    }
    const result = await this.prisma.sdlcEntityLink.deleteMany({
      where: { id: linkId, repoId, workspaceId: actor.workspaceId },
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
    const [user, participant, projectAdmin] = await Promise.all([
      tx.user.findFirst({
        where: { id: actor.userId, workspaceId: actor.workspaceId },
        select: { role: true },
      }),
      tx.channelParticipant.findFirst({
        where: {
          userId: actor.userId,
          channel: { projectId, workspaceId: actor.workspaceId },
        },
        select: { id: true },
      }),
      tx.resourceAccess.findFirst({
        where: {
          workspaceId: actor.workspaceId,
          accessType: AccessType.ADMIN,
          resource: { name: 'LISTPROJECTS' },
          OR: [
            { userId: actor.userId },
            {
              userGroup: {
                workspaceId: actor.workspaceId,
                userGroupMappings: { some: { userId: actor.userId } },
              },
            },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!user || user.role === WorkspaceRole.GUEST || (!participant && !projectAdmin)) {
      throw new AppError('You must be a project participant to attach a repository', 403);
    }
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

  private async requireRepositoryRole(actor: SdlcActor, repoId: string, requireAdmin: boolean) {
    const repo = await this.prisma.repo.findFirst({
      where: { id: repoId, workspaceId: actor.workspaceId, channelId: { not: null } },
      include: {
        channel: {
          select: {
            participants: {
              where: { userId: actor.userId },
              select: { role: true },
            },
          },
        },
      },
    });
    if (!repo || !repo.channelId || !repo.projectId) {
      throw new AppError('SDLC repository not found', 404);
    }
    const participant = repo.channel?.participants[0];
    if (!participant) {
      throw new AppError('You are not a member of this repository', 403);
    }
    if (requireAdmin && participant.role !== ChannelRole.ADMIN) {
      throw new AppError('Repository admin access is required', 403);
    }
    return repo;
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
