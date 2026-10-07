/**
 * Desk Auto-Assign Controller — desk-scoped batch operations over tickets.
 */

import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { autoAssignSweepQueue } from '@/queues/autoAssignSweepQueue';
import { authorizeAppDeskManager } from '@/integrations/routes/app-desk';

export class DeskAutoAssignController {
  /**
   * POST /channels/:channelId/desk/auto-assign-unassigned
   *
   * Requests an auto-assign sweep of the desk's unassigned tickets and returns
   * immediately (202). The work runs on the auto-assign sweep queue, which
   * routes each ticket through the same classification worker that assigns a
   * newly created ticket — so assignment, activities, workload sync and
   * websocket updates all behave identically, and tickets appear assigned in
   * the UI as the queue drains.
   *
   * Deliberately not synchronous: a desk backlog is unbounded, and holding an
   * HTTP request open across hundreds of per-ticket assignments would outlast
   * proxy timeouts while the work carried on invisibly.
   */
  autoAssignUnassigned = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Gate before any work (writes its own response on failure): 404 hides
      // cross-workspace channels, 400 for non-desk channels, 403 for
      // non-managers — the same rule the frontend's canManage flag encodes.
      const channel = await authorizeAppDeskManager(channelId, userId, workspaceId, res);
      if (!channel) return;

      const { queued } = await autoAssignSweepQueue.enqueue({
        workspaceId,
        scope: { channelId },
        requestedBy: userId,
      });

      logger.info('[DeskAutoAssignController] autoAssignUnassigned requested', {
        channelId,
        userId,
        queued,
      });

      res.status(202).json({ status: queued ? 'queued' : 'already_running' });
    } catch (error) {
      logger.error('[DeskAutoAssignController] autoAssignUnassigned failed', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to start auto-assignment', code: 'INTERNAL_ERROR' });
    }
  };
}
