import { randomUUID } from 'crypto';
import {
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  AccessType,
  BoardType,
  CanvasRole,
  CanvasVisibility,
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  ConversationParticipation,
  MessageType,
  TicketStatusV2,
  WorkspaceRole,
  type AttachSdlcRepositoryInput,
  type CreateSdlcArtifactInput,
  type CreateSdlcClawArtifactInput,
  type CreateSdlcLinkInput,
  type CreateSdlcTicketInput,
  type StartSdlcWorkInput,
  type UpdateSdlcBaselineDraftInput,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { sdlcSetupQueue } from '@/queues/sdlcSetupQueue';
import { sdlcWorkQueue } from '@/queues/sdlcWorkQueue';
import { vespaQueue } from '@/queues/vespaQueue';
import { convertBlockNoteToMarkdown, convertMarkdownToBlockNote } from '@/services/canvasService';
import {
  cancelS2SClawRun,
  getClawDebugArtifacts,
  type ClawDebugArtifactBundle,
} from '@/services/clawAgentService';
import { TicketIdService } from '@/services/ticketIdService';
import { logger } from '@/utils/logger';
import { syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import {
  applyBaselineDraftSection,
  baselineDraftMissingSections,
  buildBaselineDraftMarkdown,
  finalizeBaselineMetadata,
  isCompletedBaselineMetadata,
} from './sdlcBaselineDraft';
import { commitAndSyncCanvasArtifact } from './sdlcBaselineCanvasSync';
import { sdlcClawExecutionService } from './SdlcClawExecutionService';
import {
  allBaselinesApproved,
  ARTIFACT_CAPABILITIES,
  BASELINE_CAPABILITIES,
  START_WORK_CAPABILITIES,
} from './sdlcProgressiveGate';
import type {
  ApprovedSdlcBaseline,
  SdlcActor,
  SdlcArtifact,
  SdlcHub,
  SdlcLink,
  SdlcRepositoryHub,
  SdlcRepositoryRunContext,
  SdlcSetupExecution,
  SdlcWorkExecution,
  SdlcTicket,
} from './types';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import { sdlcAgentContext } from './SdlcAgentContextService';
import { sdlcTicketStartBlock } from './sdlcTicketPolicy';
import { sdlcVcs } from './vcs';

const SDLC_FOLDERS = ['Baseline', 'PRDs', 'Tech Docs'] as const;
const SDLC_STAGES = [
  { name: 'Backlog', sequenceNumber: 1, defaultTicketStatusV2: TicketStatusV2.TODO },
  { name: 'In Progress', sequenceNumber: 2, defaultTicketStatusV2: TicketStatusV2.STARTED },
  { name: 'In Review', sequenceNumber: 3, defaultTicketStatusV2: TicketStatusV2.STARTED },
  { name: 'Done', sequenceNumber: 4, defaultTicketStatusV2: TicketStatusV2.COMPLETED },
] as const;

type TransactionClient = Prisma.TransactionClient;

export class SdlcHubService implements SdlcHub {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async attachRepository(
    actor: SdlcActor,
    input: AttachSdlcRepositoryInput
  ): Promise<SdlcRepositoryHub> {
    const parsedRepository = sdlcVcs.parseRepository('GITHUB', input.url);
    const canonicalUrl = parsedRepository.canonicalUrl;
    const name = input.name?.trim() || parsedRepository.name;

    try {
      const repository = await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: input.projectId, workspaceId: actor.workspaceId },
          select: { id: true, name: true, sdlcBoardId: true },
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

        const boardId = await this.ensureSdlcBoard(tx, {
          projectId: project.id,
          projectName: project.name,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          existingBoardId: project.sdlcBoardId,
        });

        const repoId = randomUUID();
        const channelId = randomUUID();
        const now = new Date();

        await tx.channel.create({
          data: {
            id: channelId,
            name: `${name} · SDLC`,
            description: `Private SDLC workspace for ${name}`,
            type: ChannelType.DEFAULT,
            scopeType: ChannelScopeType.DEFAULT,
            visibility: ChannelVisibility.PRIVATE,
            createdBy: actor.userId,
            projectId: project.id,
            workspaceId: actor.workspaceId,
            participantCount: 1,
            addUserPolicy: ChannelAddUserPolicy.ADMINS_ONLY,
            showTicketsTabTicketsInChat: false,
            metadata: {
              surface: 'SDLC',
              hiddenFromChat: true,
              repoId,
            },
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
            accessCheckStatus: 'NOT_CHECKED',
          },
        });

        return {
          id: repo.id,
          name: repo.name,
          url: repo.url,
          canonicalUrl,
          projectId: project.id,
          channelId,
          boardId,
        };
      });
      try {
        await sdlcVcs.queueRepositoryCheck(actor, repository.id);
      } catch (error) {
        logger.error('[SDLC] automatic access-check dispatch failed', {
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
      await sdlcSetupQueue.enqueue(execution.id);
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
      await sdlcSetupQueue.enqueue(execution.id);
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

  async getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string,
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
      await tx.sdlcVcsRuntimeGrant.deleteMany({ where: { executionId: execution.id } });
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
    return { executionId: execution.id, status: 'CANCELLED' };
  }

  async restartSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution> {
    await this.cancelSetup(actor, repoId);
    return this.retrySetup(actor, repoId);
  }

  async createArtifact(
    actor: SdlcActor,
    repoId: string,
    input: CreateSdlcArtifactInput
  ): Promise<SdlcArtifact> {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    await this.requireArtifactCreationGate(actor, repoId, repo.channelId!);
    const folderName = input.kind === 'PRD' ? 'PRDs' : 'Tech Docs';
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { channelId: repo.channelId, name: folderName },
      select: { id: true },
    });
    if (!folder) {
      throw new AppError(`${folderName} folder not found`, 409);
    }

    if (input.kind === 'TECH_DOC' && !input.parentCanvasId) {
      throw new AppError('Tech Doc requires a parent PRD', 400);
    }
    if (input.generateWithAi) {
      if (input.kind === 'TECH_DOC' && input.parentCanvasId) {
        const parent = await this.prisma.canvas.findFirst({
          where: { id: input.parentCanvasId, channelId: repo.channelId },
          select: { metadata: true },
        });
        const metadata = parent?.metadata as Record<string, unknown> | null;
        if (metadata?.repoId !== repoId || metadata.artifactKind !== 'PRD') {
          throw new AppError('PRD canvas not found', 404);
        }
      }
      const conversationId = `chat-sdlc-artifact-${randomUUID()}`;
      const context = JSON.stringify({
        repoId,
        phase: 'QUEUED',
        kind: input.kind,
        title: input.title,
        prompt: input.aiPrompt,
        parentCanvasId: input.parentCanvasId,
        conversationId,
      });
      const execution = await this.prisma.$transaction(async (tx) => {
        const workflow = await tx.workflow.create({
          data: {
            workspaceId: actor.workspaceId,
            workflowName: `SDLC ${input.kind.toLowerCase()}: ${input.title}`,
            workflowType: 'SDLC_ARTIFACT',
            status: 'PENDING',
            context,
            metadata: JSON.stringify({ repoId, kind: input.kind }),
          },
        });
        return tx.workflowExecution.create({
          data: {
            workspaceId: actor.workspaceId,
            workflowId: workflow.id,
            workflowType: 'SDLC_ARTIFACT',
            status: 'PENDING',
            context,
            createdBy: actor.userId,
          },
        });
      });
      try {
        await sdlcClawExecutionService.dispatchArtifact(execution.id);
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
                error: message,
              }),
            },
          }),
          this.prisma.workflow.update({
            where: { id: execution.workflowId },
            data: { status: 'FAILURE' },
          }),
        ]);
        throw new AppError(`Failed to start Claw artifact generation: ${message}`, 503);
      }
      return { kind: input.kind, executionId: execution.id, conversationId };
    }
    const artifactContent = input.content;

    return this.prisma.$transaction(async (tx) => {
      if (input.kind === 'TECH_DOC' && input.parentCanvasId) {
        await this.requireArtifactCanvas(tx, repoId, repo.channelId!, input.parentCanvasId, 'PRD');
        const existing = await tx.sdlcEntityLink.findFirst({
          where: {
            repoId,
            sourceType: 'CANVAS',
            sourceId: input.parentCanvasId,
            relationType: 'TECH_DOC',
          },
        });
        if (existing) {
          throw new AppError('PRD already has a Tech Doc', 409);
        }
      }

      const canvas = await tx.canvas.create({
        data: {
          workspaceId: actor.workspaceId,
          title: input.title,
          content: artifactContent as Prisma.InputJsonValue,
          channelId: repo.channelId,
          folderId: folder.id,
          projectId: repo.projectId,
          createdBy: actor.userId,
          lastEditedBy: actor.userId,
          lastEditedAt: new Date(),
          visibility: CanvasVisibility.PRIVATE,
          isCollaborative: true,
          metadata: {
            surface: 'SDLC',
            repoId,
            artifactKind: input.kind,
          },
          participants: {
            create: {
              workspaceId: actor.workspaceId,
              channelId: repo.channelId,
              role: CanvasRole.EDITOR,
            },
          },
        },
      });

      if (input.kind === 'TECH_DOC' && input.parentCanvasId) {
        await tx.sdlcEntityLink.create({
          data: {
            workspaceId: actor.workspaceId,
            repoId,
            sourceType: 'CANVAS',
            sourceId: input.parentCanvasId,
            targetType: 'CANVAS',
            targetId: canvas.id,
            relationType: 'TECH_DOC',
            createdBy: actor.userId,
          },
        });
      }

      return { canvasId: canvas.id, kind: input.kind };
    });
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
    } else {
      await this.requireArtifactCreationGate(actor, input.repoId, repo.channelId);
    }

    const folderName =
      input.kind === 'BASELINE' ? 'Baseline' : input.kind === 'PRD' ? 'PRDs' : 'Tech Docs';
    const folder = await this.prisma.canvasFolder.findFirst({
      where: { channelId: repo.channelId, name: folderName },
      select: { id: true },
    });
    if (!folder) throw new AppError(`${folderName} folder not found`, 409);

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
      const existing = await this.findSdlcCanvas(repo.channelId, {
        artifactKind: 'BASELINE',
        baselineKind: input.baselineKind,
        setupExecutionId: input.setupExecutionId,
      });
      if (existing) {
        return {
          canvasId: existing.id,
          viewAccessId: existing.viewAccessId ?? undefined,
          url: `/chat/canvas/${existing.id}`,
          kind: 'BASELINE',
        };
      }
    }

    if (input.workflowExecutionId && input.kind !== 'BASELINE') {
      const existing = await this.findSdlcCanvas(repo.channelId, {
        workflowExecutionId: input.workflowExecutionId,
        artifactKind: input.kind,
      });
      if (existing) {
        return {
          canvasId: existing.id,
          viewAccessId: existing.viewAccessId ?? undefined,
          url: `/chat/canvas/${existing.id}`,
          kind: input.kind,
        };
      }
    }

    const content = await convertMarkdownToBlockNote(input.markdown);
    return commitAndSyncCanvasArtifact(
      () =>
        this.prisma.$transaction(async (tx) => {
          if (input.kind === 'TECH_DOC' && input.parentCanvasId) {
            await this.requireArtifactCanvas(
              tx,
              repo.id,
              repo.channelId!,
              input.parentCanvasId,
              'PRD'
            );
          }
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
              metadata: {
                source: 'claw',
                surface: 'SDLC',
                repoId: repo.id,
                projectId: repo.projectId,
                repositoryUrl: repo.url,
                artifactKind: input.kind,
                ...(input.baselineKind ? { baselineKind: input.baselineKind } : {}),
                ...(input.setupExecutionId ? { setupExecutionId: input.setupExecutionId } : {}),
                ...(input.workflowExecutionId
                  ? { workflowExecutionId: input.workflowExecutionId }
                  : {}),
                ...(input.generationCommit ? { generationCommit: input.generationCommit } : {}),
                ...(input.kind === 'BASELINE' ? { generationStatus: 'READY' } : {}),
              },
              participants: {
                create: {
                  workspaceId: actor.workspaceId,
                  channelId: repo.channelId,
                  role: input.kind === 'BASELINE' ? CanvasRole.VIEWER : CanvasRole.EDITOR,
                },
              },
            },
          });

          if (input.kind === 'TECH_DOC' && input.parentCanvasId) {
            await tx.sdlcEntityLink.create({
              data: {
                workspaceId: actor.workspaceId,
                repoId: repo.id,
                sourceType: 'CANVAS',
                sourceId: input.parentCanvasId,
                targetType: 'CANVAS',
                targetId: canvas.id,
                relationType: 'TECH_DOC',
                createdBy: actor.userId,
              },
            });
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
            where: { channelId: repo.channelId },
            select: { id: true, viewAccessId: true, metadata: true, content: true },
          });
          let canvas = candidates.find((candidate) => {
            const metadata = candidate.metadata as Record<string, unknown> | null;
            return (
              metadata?.artifactKind === 'BASELINE' &&
              metadata.baselineKind === input.baselineKind &&
              metadata.setupExecutionId === input.setupExecutionId
            );
          });

          if (!canvas) {
            if (input.action === 'finalize') {
              throw new AppError('Begin the baseline draft before finalizing it', 409);
            }
            const metadata: Record<string, unknown> = {
              source: 'claw',
              surface: 'SDLC',
              repoId: repo.id,
              projectId: repo.projectId,
              repositoryUrl: repo.url,
              artifactKind: 'BASELINE',
              baselineKind: input.baselineKind,
              setupExecutionId: input.setupExecutionId,
              workflowExecutionId: input.workflowExecutionId,
              generationStatus: 'GENERATING',
              draftSections: {},
            };
            const nextMetadata =
              input.action === 'upsert_section'
                ? this.applyValidatedDraftSection(definition, metadata, input)
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
                participants: {
                  create: {
                    workspaceId: actor.workspaceId,
                    channelId: repo.channelId,
                    role: CanvasRole.VIEWER,
                  },
                },
              },
              select: { id: true, viewAccessId: true, metadata: true, content: true },
            });
            canvas = created;
          } else if (!isCompletedBaselineMetadata(canvas.metadata as Record<string, unknown>)) {
            const metadata = canvas.metadata as Record<string, unknown>;
            if (input.action === 'upsert_section') {
              const nextMetadata = this.applyValidatedDraftSection(definition, metadata, input);
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
                select: { id: true, viewAccessId: true, metadata: true, content: true },
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
              const nextMetadata = finalizeBaselineMetadata(input.baselineKind, metadata);
              canvas = await tx.canvas.update({
                where: { id: canvas.id },
                data: {
                  title: input.title,
                  content: content as unknown as Prisma.InputJsonValue,
                  metadata: nextMetadata as Prisma.InputJsonValue,
                  lastEditedBy: actor.userId,
                  lastEditedAt: new Date(),
                },
                select: { id: true, viewAccessId: true, metadata: true, content: true },
              });
            }
          }

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

  async createTicket(
    actor: SdlcActor,
    repoId: string,
    input: CreateSdlcTicketInput
  ): Promise<SdlcTicket> {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    await this.requireArtifactCreationGate(actor, repoId, repo.channelId!);
    const boardId = repo.project?.sdlcBoardId;
    if (!boardId) {
      throw new AppError('SDLC board is not configured for this repository', 409);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      if (input.sourceCanvasId) {
        const chainCanvasIds = await this.requireArtifactChain(
          tx,
          repoId,
          repo.channelId!,
          input.sourceCanvasId
        );
        const existing = await tx.sdlcEntityLink.findFirst({
          where: {
            repoId,
            sourceType: 'CANVAS',
            sourceId: { in: chainCanvasIds },
            relationType: 'TICKET',
          },
          select: { id: true },
        });
        if (existing) {
          throw new AppError('This PRD chain already has a Ticket', 409);
        }
      }

      const ticket = await this.createTicketRecord(tx, actor, {
        repoId,
        projectId: repo.projectId!,
        channelId: repo.channelId!,
        boardId,
        title: input.title,
        description: input.description,
        sourceCanvasId: input.sourceCanvasId,
        stageName: 'Backlog',
      });
      return { ticketId: ticket.id };
    });
  }

  async linkContext(
    actor: SdlcActor,
    repoId: string,
    input: CreateSdlcLinkInput
  ): Promise<SdlcLink> {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    await this.requireLinkSource(repoId, repo.channelId!, input.sourceType, input.sourceId);
    await this.requireAccessibleEntity(actor, input.targetType, input.targetId);
    try {
      const link = await this.prisma.sdlcEntityLink.create({
        data: { ...input, workspaceId: actor.workspaceId, repoId, createdBy: actor.userId },
      });
      return link;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('This SDLC relationship already exists', 409);
      }
      throw error;
    }
  }

  async unlinkContext(actor: SdlcActor, repoId: string, linkId: string): Promise<void> {
    await this.requireRepositoryRole(actor, repoId, false);
    const result = await this.prisma.sdlcEntityLink.deleteMany({
      where: { id: linkId, repoId, workspaceId: actor.workspaceId },
    });
    if (result.count === 0) {
      throw new AppError('SDLC relationship not found', 404);
    }
  }

  async approveBaseline(
    actor: SdlcActor,
    repoId: string,
    canvasId: string
  ): Promise<ApprovedSdlcBaseline> {
    const repo = await this.requireRepositoryRole(actor, repoId, true);
    const approval = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."canvases" WHERE "id" = ${canvasId} FOR UPDATE`;
      const canvas = await tx.canvas.findFirst({
        where: { id: canvasId, channelId: repo.channelId },
        select: { id: true, title: true, content: true, metadata: true },
      });
      const metadata = canvas?.metadata as Record<string, unknown> | null | undefined;
      if (
        !canvas ||
        metadata?.surface !== 'SDLC' ||
        metadata.repoId !== repoId ||
        metadata.artifactKind !== 'BASELINE' ||
        !isCompletedBaselineMetadata(metadata)
      ) {
        throw new AppError('Finalized baseline canvas not found', 404);
      }

      const markdown = await convertBlockNoteToMarkdown(canvas.content as unknown[]);
      const existingDocumentId =
        typeof metadata.knowledgeDocumentId === 'string' ? metadata.knowledgeDocumentId : undefined;
      const existingDocument = existingDocumentId
        ? await tx.knowledgeDocument.findFirst({
            where: { id: existingDocumentId, workspaceId: actor.workspaceId },
            select: { id: true },
          })
        : null;
      const approvedAt = new Date();
      const document = existingDocument
        ? await tx.knowledgeDocument.update({
            where: { id: existingDocument.id },
            data: {
              title: canvas.title,
              content: markdown,
              repositoryUrl: repo.url,
              workflowExecutionId: repo.sdlcSetupExecutionId,
              approvedBy: actor.userId,
              approvedAt,
              metadata: {
                canvasId,
                repoId,
                baselineKind:
                  typeof metadata.baselineKind === 'string' ? metadata.baselineKind : null,
                generationCommit:
                  typeof metadata.generationCommit === 'string' ? metadata.generationCommit : null,
              },
            },
          })
        : await tx.knowledgeDocument.create({
            data: {
              workspaceId: actor.workspaceId,
              projectId: repo.projectId!,
              repositoryUrl: repo.url,
              title: canvas.title,
              content: markdown,
              workflowExecutionId: repo.sdlcSetupExecutionId,
              approvedBy: actor.userId,
              approvedAt,
              metadata: {
                canvasId,
                repoId,
                baselineKind:
                  typeof metadata.baselineKind === 'string' ? metadata.baselineKind : null,
                generationCommit:
                  typeof metadata.generationCommit === 'string' ? metadata.generationCommit : null,
              },
            },
          });

      await tx.canvas.update({
        where: { id: canvasId },
        data: {
          metadata: {
            ...metadata,
            approvedAt: approvedAt.toISOString(),
            approvedBy: actor.userId,
            knowledgeDocumentId: document.id,
          },
        },
      });
      return document.id;
    });

    const canvases = await this.prisma.canvas.findMany({
      where: { channelId: repo.channelId },
      select: { metadata: true },
    });
    const approvedKinds = new Set(
      canvases.flatMap((canvas) => {
        const metadata = canvas.metadata as Record<string, unknown> | null;
        return metadata?.artifactKind === 'BASELINE' &&
          typeof metadata.baselineKind === 'string' &&
          typeof metadata.approvedAt === 'string'
          ? [metadata.baselineKind]
          : [];
      })
    );
    const allBaselinesApproved = BASELINE_DEFINITIONS.every((item) => approvedKinds.has(item.kind));
    if (allBaselinesApproved && repo.sdlcSetupExecutionId) {
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: repo.sdlcSetupExecutionId },
        select: { context: true },
      });
      if (execution) {
        let context: Record<string, unknown> = {};
        try {
          context = execution.context
            ? (JSON.parse(execution.context) as Record<string, unknown>)
            : {};
        } catch {
          context = {};
        }
        await this.prisma.workflowExecution.update({
          where: { id: repo.sdlcSetupExecutionId },
          data: { context: JSON.stringify({ ...context, phase: 'APPROVED' }) },
        });
      }
    }
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        app: SubApp.CANVAS,
      });
    } catch {
      // Approval is durable. Search refresh can be retried independently.
    }
    return {
      canvasId,
      knowledgeDocumentId: approval,
      allBaselinesApproved,
    };
  }

  async startWork(
    actor: SdlcActor,
    repoId: string,
    input: StartSdlcWorkInput
  ): Promise<SdlcWorkExecution> {
    const repo = await this.requireRepositoryRole(actor, repoId, false);
    await sdlcVcs.requireCapabilities(actor, repoId, [...START_WORK_CAPABILITIES]);
    const boardId = repo.project?.sdlcBoardId;
    if (!boardId) {
      throw new AppError('SDLC board is not configured for this repository', 409);
    }
    const baselines = await this.prisma.canvas.findMany({
      where: { channelId: repo.channelId },
      select: { metadata: true },
    });
    if (!allBaselinesApproved(baselines)) {
      throw new AppError('Approve all five baseline documents before starting work', 409);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      let ticket =
        input.sourceType === 'TICKET'
          ? await tx.ticket.findFirst({
              where: { id: input.sourceId, channelId: repo.channelId! },
            })
          : null;
      let sourceTitle = ticket?.title;
      let sourceDescription = ticket?.description;

      if (input.sourceType === 'CANVAS') {
        const canvas = await tx.canvas.findFirst({
          where: { id: input.sourceId, channelId: repo.channelId! },
          select: { id: true, title: true, content: true, metadata: true },
        });
        const metadata = canvas?.metadata as Record<string, unknown> | null | undefined;
        if (
          !canvas ||
          metadata?.surface !== 'SDLC' ||
          !['PRD', 'TECH_DOC'].includes(String(metadata.artifactKind))
        ) {
          throw new AppError('SDLC PRD or Tech Doc not found', 404);
        }
        sourceTitle = canvas.title;
        sourceDescription = await convertBlockNoteToMarkdown(canvas.content as unknown[]);
        const chainCanvasIds = await this.requireArtifactChain(
          tx,
          repoId,
          repo.channelId!,
          input.sourceId
        );
        const existingLink = await tx.sdlcEntityLink.findFirst({
          where: {
            repoId,
            sourceType: 'CANVAS',
            sourceId: { in: chainCanvasIds },
            relationType: 'TICKET',
          },
        });
        if (existingLink?.targetType === 'TICKET') {
          ticket = await tx.ticket.findFirst({
            where: { id: existingLink.targetId, channelId: repo.channelId! },
          });
        }
      }
      if (input.sourceType === 'TICKET' && !ticket) {
        throw new AppError('SDLC Ticket not found', 404);
      }

      if (!ticket) {
        ticket = await this.createTicketRecord(tx, actor, {
          repoId,
          projectId: repo.projectId!,
          channelId: repo.channelId!,
          boardId,
          title: sourceTitle || 'SDLC Ticket',
          description: sourceDescription || '',
          sourceCanvasId: input.sourceType === 'CANVAS' ? input.sourceId : undefined,
          stageName: 'In Progress',
        });
      }

      const [running, pullRequest] = await Promise.all([
        tx.workflowExecution.findFirst({
          where: {
            workflow: { ticketId: ticket.id, workflowType: 'SDLC_WORK' },
            status: { in: ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'] },
          },
          select: { id: true },
        }),
        tx.pullRequests.findFirst({
          where: { ticketId: ticket.id },
          select: { id: true },
        }),
      ]);
      const startBlock = sdlcTicketStartBlock({
        repoId,
        boardId,
        channelId: repo.channelId!,
        ticket,
        hasActiveExecution: Boolean(running),
        hasPullRequest: Boolean(pullRequest),
      });
      if (startBlock === 'NOT_TICKET') {
        throw new AppError('SDLC Ticket not found', 404);
      }
      if (startBlock === 'ACTIVE_EXECUTION') {
        throw new AppError('Work is already running for this Ticket', 409);
      }
      if (startBlock === 'IMPLEMENTATION_FINISHED') {
        throw new AppError('This Ticket already has a pull request', 409);
      }

      const workflowExecutionId = randomUUID();
      const context = JSON.stringify({
        repoId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        ticketId: ticket.id,
        conversationId: `chat-sdlc-work-${workflowExecutionId}`,
        phase: 'QUEUED',
      });
      const workflow = await tx.workflow.create({
        data: {
          workspaceId: actor.workspaceId,
          ticketId: ticket.id,
          workflowName: `SDLC work: ${ticket.xyneId}`,
          workflowType: 'SDLC_WORK',
          status: 'PENDING',
          context,
          metadata: JSON.stringify({
            repoId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          }),
        },
      });
      const execution = await tx.workflowExecution.create({
        data: {
          id: workflowExecutionId,
          workspaceId: actor.workspaceId,
          workflowId: workflow.id,
          workflowType: 'SDLC_WORK',
          status: 'PENDING',
          context,
          createdBy: actor.userId,
        },
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          stageName: 'In Progress',
          statusV2: TicketStatusV2.STARTED,
          statusUpdatedAt: new Date(),
          updatedBy: actor.userId,
        },
      });
      return { ticketId: ticket.id, workflowExecutionId: execution.id };
    });

    try {
      await sdlcWorkQueue.enqueue(created.workflowExecutionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: created.workflowExecutionId },
        select: { workflowId: true },
      });
      await this.prisma.$transaction([
        this.prisma.workflowExecution.update({
          where: { id: created.workflowExecutionId },
          data: { status: 'FAILURE', output: JSON.stringify({ phase: 'FAILED', error: message }) },
        }),
        ...(execution
          ? [
              this.prisma.workflow.update({
                where: { id: execution.workflowId },
                data: { status: 'FAILURE' },
              }),
            ]
          : []),
      ]);
      throw new AppError('Failed to queue SDLC work', 503);
    }
    return created;
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

  private async createTicketRecord(
    tx: TransactionClient,
    actor: SdlcActor,
    input: {
      repoId: string;
      projectId: string;
      channelId: string;
      boardId: string;
      title: string;
      description: string;
      sourceCanvasId?: string;
      stageName: 'Backlog' | 'In Progress';
    }
  ) {
    const ticketId = randomUUID();
    const conversationId = randomUUID();
    const initialMessageId = randomUUID();
    const now = new Date();
    const xyneId = await TicketIdService.generateTicketId(tx, input.projectId);
    await tx.conversation.create({
      data: {
        conversationId,
        channelId: input.channelId,
        createdBy: actor.userId,
        initialMessageId,
        workspaceId: actor.workspaceId,
        lastActivityAt: now,
        ticketId,
        doNotPostToChannel: true,
        metadata: { surface: 'SDLC', repoId: input.repoId },
        messages: {
          create: {
            messageId: initialMessageId,
            senderId: actor.userId,
            workspaceId: actor.workspaceId,
            content: input.description || input.title,
            msgType: MessageType.SYSTEM,
            showInChannel: false,
          },
        },
        participants: {
          create: {
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            participationType: ConversationParticipation.AUTHOR,
            channelId: input.channelId,
          },
        },
      },
    });
    const ticket = await tx.ticket.create({
      data: {
        id: ticketId,
        title: input.title,
        description: input.description,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        conversationId,
        channelId: input.channelId,
        referenceTicket: [],
        xyneId,
        projectId: input.projectId,
        workspaceId: actor.workspaceId,
        boardId: input.boardId,
        stageName: input.stageName,
        statusV2: input.stageName === 'Backlog' ? TicketStatusV2.TODO : TicketStatusV2.STARTED,
        statusUpdatedAt: now,
        lastEmailAt: now,
        emailReplyEnabled: false,
        metadata: {
          surface: 'SDLC',
          repoId: input.repoId,
          ...(input.sourceCanvasId && {
            sourceType: 'CANVAS',
            sourceId: input.sourceCanvasId,
          }),
        },
      },
    });
    if (input.sourceCanvasId) {
      await tx.sdlcEntityLink.create({
        data: {
          workspaceId: actor.workspaceId,
          repoId: input.repoId,
          sourceType: 'CANVAS',
          sourceId: input.sourceCanvasId,
          targetType: 'TICKET',
          targetId: ticket.id,
          relationType: 'TICKET',
          createdBy: actor.userId,
        },
      });
    }
    return ticket;
  }

  private async requireArtifactChain(
    tx: TransactionClient,
    repoId: string,
    channelId: string,
    canvasId: string
  ): Promise<string[]> {
    const canvas = await tx.canvas.findFirst({
      where: { id: canvasId, channelId },
      select: { metadata: true },
    });
    const metadata = canvas?.metadata as Record<string, unknown> | null | undefined;
    const artifactKind = metadata?.artifactKind;
    if (
      !canvas ||
      metadata?.surface !== 'SDLC' ||
      metadata.repoId !== repoId ||
      !['PRD', 'TECH_DOC'].includes(String(artifactKind))
    ) {
      throw new AppError('SDLC PRD or Tech Doc not found', 404);
    }

    const techDocLink = await tx.sdlcEntityLink.findFirst({
      where: {
        repoId,
        sourceType: 'CANVAS',
        targetType: 'CANVAS',
        relationType: 'TECH_DOC',
        ...(artifactKind === 'PRD' ? { sourceId: canvasId } : { targetId: canvasId }),
      },
      select: { sourceId: true, targetId: true },
    });
    return [
      ...new Set([canvasId, ...(techDocLink ? [techDocLink.sourceId, techDocLink.targetId] : [])]),
    ];
  }

  private applyValidatedDraftSection(
    definition: (typeof BASELINE_DEFINITIONS)[number],
    metadata: Record<string, unknown>,
    input: UpdateSdlcBaselineDraftInput
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
    });
  }

  private async ensureSdlcBoard(
    tx: TransactionClient,
    input: {
      projectId: string;
      projectName: string;
      workspaceId: string;
      userId: string;
      existingBoardId: string | null;
    }
  ): Promise<string> {
    let board = input.existingBoardId
      ? await tx.board.findFirst({
          where: { id: input.existingBoardId, projectId: input.projectId },
          select: { id: true },
        })
      : null;

    if (!board) {
      board = await tx.board.findFirst({
        where: { projectId: input.projectId, name: 'SDLC' },
        select: { id: true },
      });
    }

    if (!board) {
      board = await tx.board.create({
        data: {
          name: 'SDLC',
          description: `AI software lifecycle for ${input.projectName}`,
          boardType: BoardType.DEFAULT,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          createdBy: input.userId,
          metadata: { surface: 'SDLC' },
        },
        select: { id: true },
      });
    }

    const existingStages = await tx.stage.findMany({
      where: { boardId: board.id },
      select: { name: true },
    });
    const existingNames = new Set(existingStages.map((stage) => stage.name));
    const missingStages = SDLC_STAGES.filter((stage) => !existingNames.has(stage.name));
    if (missingStages.length > 0) {
      await tx.stage.createMany({
        data: missingStages.map((stage) => ({
          ...stage,
          boardId: board!.id,
          workspaceId: input.workspaceId,
          createdBy: input.userId,
        })),
      });
    }

    if (input.existingBoardId !== board.id) {
      await tx.project.update({
        where: { id: input.projectId },
        data: { sdlcBoardId: board.id, updatedBy: input.userId },
      });
    }
    return board.id;
  }

  private async requireArtifactCreationGate(
    actor: SdlcActor,
    repoId: string,
    channelId: string
  ): Promise<void> {
    await sdlcVcs.requireCapabilities(actor, repoId, [...ARTIFACT_CAPABILITIES]);
    const baselines = await this.prisma.canvas.findMany({
      where: { channelId },
      select: { metadata: true },
    });
    if (!allBaselinesApproved(baselines)) {
      throw new AppError('Approve all five baseline documents before creating SDLC artifacts', 409);
    }
  }

  private async requireRepositoryRole(actor: SdlcActor, repoId: string, requireAdmin: boolean) {
    const repo = await this.prisma.repo.findFirst({
      where: { id: repoId, workspaceId: actor.workspaceId, channelId: { not: null } },
      include: {
        project: { select: { sdlcBoardId: true } },
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
    expected: Record<string, unknown>
  ): Promise<{ id: string; viewAccessId: string | null } | null> {
    const canvases = await this.prisma.canvas.findMany({
      where: { channelId },
      select: { id: true, viewAccessId: true, metadata: true },
    });
    return (
      canvases.find((canvas) => {
        const metadata = canvas.metadata as Record<string, unknown> | null;
        return (
          metadata && Object.entries(expected).every(([key, value]) => metadata[key] === value)
        );
      }) ?? null
    );
  }

  private async requireArtifactCanvas(
    tx: TransactionClient,
    repoId: string,
    channelId: string,
    canvasId: string,
    artifactKind: string
  ): Promise<void> {
    const canvas = await tx.canvas.findFirst({
      where: { id: canvasId, channelId },
      select: { metadata: true },
    });
    const metadata = canvas?.metadata as Record<string, unknown> | null | undefined;
    if (
      !canvas ||
      metadata?.surface !== 'SDLC' ||
      metadata.repoId !== repoId ||
      metadata.artifactKind !== artifactKind
    ) {
      throw new AppError(`${artifactKind} canvas not found`, 404);
    }
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
