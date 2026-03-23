import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { BaseGcsAdapter } from './baseGcsAdapter';
import type { MemoryIngestionContext } from '../types';

export class WorkflowExecutionAdapter extends BaseGcsAdapter {
  constructor(gcsUri: string, sourceId: string) {
    super(gcsUri, sourceId);
  }

  async buildMemoryContext(): Promise<MemoryIngestionContext> {
    let ticketId = '';
    let repoUrl = '';
    let commitId = '';
    let userId = '';
    try {
      const step = await db.workflowStep.findUnique({
        where: { id: this.sourceId },
        select: { workflowExecutionId: true },
      });
      if (!step) {
        throw new Error(`WorkflowStep not found for id=${this.sourceId}`);
      }
      const workflowExecutionId = step.workflowExecutionId;
      logger.info(`[WorkflowExecutionAdapter] Resolved workflowExecutionId=${workflowExecutionId} from stepId=${this.sourceId}`);

      const execution = await db.workflowExecution.findUnique({
        where: { id: workflowExecutionId },
        select: { workflowId: true, createdBy: true },
      });

      if (execution) {
        userId = execution.createdBy ?? '';
        const workflow = await db.workflow.findUnique({
          where: { id: execution.workflowId },
          select: { ticketId: true },
        });
        ticketId = workflow?.ticketId ?? '';
      }

      const pr = await db.pullRequests.findFirst({
        where: { workflowExecutionId },
        select: { repositoryUrl: true, sourceBranchName: true },
        orderBy: { date: 'desc' },
      });
      repoUrl = pr?.repositoryUrl ?? '';
      commitId = pr?.sourceBranchName ?? '';
    } catch (err) {
      logger.warn(`[WorkflowExecutionAdapter] Failed to enrich context for sourceId=${this.sourceId}:`, err);
    }

    return {
      // sourceId is the unique session identifier (executionId or stepId)
      sessionId: this.sourceId,
      userId,
      repoUrl,
      commitId,
      ticketId,
      fileStoragePath: this.gcsUri,
    };
  }
}
