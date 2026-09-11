import { SDLC_ACTIVE_RUN_STATUSES } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { findHubWorkflowLink } from './seedHubWorkflow';
import { requireSdlcChannelId } from './sdlcChannelMembership';

/**
 * Start the hub's Repo Knowledge workflow after a Wiki run. A workflow has one trigger,
 * so a manual one cannot subscribe to wiki completion — the caller starts it. Returns
 * null and never throws: a wiki run must not fail because the refresh could not start.
 */
export async function triggerHubKnowledgeRun(
  repoId: string,
  actorUserId: string,
): Promise<string | null> {
  try {
    const channelId = await requireSdlcChannelId(db, repoId);
    const link = await findHubWorkflowLink(channelId);
    if (!link) return null;

    const workflow = await db.workflow.findUnique({
      where: { id: link.targetId },
      select: { id: true },
    });
    if (!workflow) return null;

    // Every repository in the hub fires this when its wiki finishes, and the runs
    // all write the same documents — concurrent find-or-create steps duplicate them.
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
      repoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
