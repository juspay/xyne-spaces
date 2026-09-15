import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { sdlcQueue } from '@/queues/sdlcQueue';
import { logger } from '@/utils/logger';

const ACTIVE_STATUSES = ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'] as const;

interface BaselineReconciliationQueue {
  enqueueSetup(executionId: string, repoId: string): Promise<void>;
}

export class SdlcBaselineReconciliationService {
  constructor(
    private readonly prisma: PrismaClient = DatabaseClient.getInstance(),
    private readonly queue: BaselineReconciliationQueue = sdlcQueue
  ) {}

  async queueAfterWiki(repoId: string, wikiExecutionId: string): Promise<string | null> {
    const [repo, wikiExecution] = await Promise.all([
      this.prisma.repo.findUnique({
        where: { id: repoId },
        select: {
          id: true,
          name: true,
          workspaceId: true,
          projectId: true,
          sdlcSetupExecutionId: true,
        },
      }),
      this.prisma.workflowExecution.findUnique({
        where: { id: wikiExecutionId },
        select: { createdBy: true, status: true },
      }),
    ]);
    if (!repo?.workspaceId || !repo.projectId || !wikiExecution?.createdBy) {
      throw new Error('Wiki baseline reconciliation context is unavailable');
    }
    if (wikiExecution.status !== 'SUCCESS') {
      throw new Error('Wiki must complete before baseline reconciliation');
    }

    if (repo.sdlcSetupExecutionId) {
      const active = await this.prisma.workflowExecution.findFirst({
        where: { id: repo.sdlcSetupExecutionId, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true },
      });
      if (active) {
        logger.info('[SDLC] baseline reconciliation already active', {
          repoId,
          executionId: active.id,
          wikiExecutionId,
        });
        return active.id;
      }
    }

    const context = JSON.stringify({
      repoId,
      phase: 'QUEUED',
      refreshExisting: true,
      parentWikiExecutionId: wikiExecutionId,
      completedBaselineKinds: [],
      reconciledBaselineKinds: [],
    });
    const execution = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "public"."repos" WHERE "id" = ${repoId} FOR UPDATE`;
      const workflow = await tx.workflow.create({
        data: {
          workspaceId: repo.workspaceId!,
          workflowName: `SDLC knowledge refresh: ${repo.name}`,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context,
          metadata: JSON.stringify({
            repoId,
            projectId: repo.projectId,
            parentWikiExecutionId: wikiExecutionId,
            refreshExisting: true,
          }),
        },
      });
      const created = await tx.workflowExecution.create({
        data: {
          workspaceId: repo.workspaceId!,
          workflowId: workflow.id,
          workflowType: 'SDLC_SETUP',
          status: 'PENDING',
          context,
          createdBy: wikiExecution.createdBy!,
        },
      });
      await tx.repo.update({
        where: { id: repoId },
        data: { sdlcSetupExecutionId: created.id },
      });
      return created;
    });

    try {
      await this.queue.enqueueSetup(execution.id, repoId);
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
              error: `Failed to queue knowledge refresh: ${message}`,
            }),
          },
        }),
        this.prisma.workflow.update({
          where: { id: execution.workflowId },
          data: { status: 'FAILURE' },
        }),
      ]);
      throw error;
    }
    return execution.id;
  }
}
