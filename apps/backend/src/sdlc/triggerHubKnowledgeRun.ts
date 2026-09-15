import { SDLC_ACTIVE_RUN_STATUSES } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { findHubWorkflowLink } from './seedHubWorkflow';

export async function triggerHubKnowledgeRun(
  channelId: string,
  actorUserId: string,
): Promise<string | null> {
  try {
    const link = await findHubWorkflowLink(channelId);
    if (!link) return null;

    const workflow = await db.workflow.findUnique({
      where: { id: link.targetId },
      select: { id: true },
    });
    if (!workflow) return null;

    // Every hub repository fires this, and concurrent runs duplicate the same documents.
    const inFlight = await db.workflowExecution.findFirst({
      where: { workflowId: workflow.id, status: { in: [...SDLC_ACTIVE_RUN_STATUSES] } },
      select: { id: true },
    });
    if (inFlight) {
      logger.info(
        `[SDLC] hub knowledge run ${inFlight.id} already in flight for ${channelId}, skipping`,
      );
      return null;
    }

    return await workflowRuntime.triggerManual(
      { userId: actorUserId, workspaceId: link.workspaceId },
      workflow.id,
      {},
    );
  } catch (error) {
    logger.error('[SDLC] hub knowledge run could not be started', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
