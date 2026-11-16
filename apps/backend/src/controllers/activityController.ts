import { Request, Response } from 'express';
import { ValidatedActivityPayload } from '@/validators/activityValidator';
import { ActivityLogEntry } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { authSessionService } from '@/services/authSessionService';
import { activityService } from '@/services/activity/activityService';
import { sudoQueryService } from '@/services/hyperAnalytics/sudoQueryService';
import { resolveModule } from '@/services/hyperAnalytics/moduleRoutes';

export class ActivityController {
  /**
   * POST /api/activity/log
   * Receives activity log from frontend and logs to stdout
   *
   * Note: Validation is handled by validateZod middleware in the route.
   * By the time we reach here, req.body is already validated.
   *
   * 1. Enriches payload with server-side data (including platform from the auth session)
   * 2. Logs to stdout as JSON
   * 3. Returns success response
   */
  async logActivity(req: Request, res: Response): Promise<void> {
    try {
      // req.body is already validated by middleware
      const body = req.body as ValidatedActivityPayload;
      if (!req.user?.id) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      // Identity comes from the session, never from the request body.
      const validated: ValidatedActivityPayload = { ...body, userId: req.user.id, userEmail: req.user.email ?? '' };

      // Platform of the device this sign-in belongs to (web | electron | android | ios)
      let platform: string | undefined;
      const sessionId = req.user?.sid;
      if (sessionId) {
        try {
          const session = await authSessionService.findById(sessionId);
          platform = session?.platform;
        } catch (err) {
          logger.warn('Failed to fetch platform from session', { error: err });
        }
      }

      const logEntry: ActivityLogEntry = {
        ...validated,
        ...(platform && { platform }),
        serverTimestamp: new Date().toISOString(),
        severity: 'INFO',
      };

      logger.info('Activity logged', {
        eventType: 'activity',
        ...logEntry
      });


      if (validated.triggerEvent === 'page_change') {
        try {
          // page arrives workspace-prefixed (`/${workspaceId}${path}`). Only
          // whitelisted modules are tracked, so no record id is ever sent.
          const resolved = resolveModule(validated.page);

          if (resolved) {
            sudoQueryService.identify({ id: validated.userId, email: validated.userEmail });
            sudoQueryService.track('module_open', {
              userId: validated.userId,
              module: resolved.module, // '/calls', '/chat/dm', '/chat/dir/recap'
              workspaceId: resolved.workspaceId,
              ...(platform && { platform }),
            });
          }
        } catch (err) {
          logger.debug('[ModuleMetrics] track failed (non-blocking)', { error: err });
        }
      }

      res.status(200).json({ success: true });
      logger.debug('ACTIVITY_TRACE [Backend-Controller]: Response sent (200 OK) ✓');

    } catch (error) {
      // Unexpected error (logging failure, etc.)
      logger.error('Unexpected error in activity logging', {
        eventType: 'activity_error',
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  async getWorkspaceActivityCounts(req: Request, res: Response): Promise<void> {
    try {
      const memberId = req.user?.memberId;
      if (!memberId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const counts = await activityService.getWorkspaceActivityCounts(memberId);

      res.json({ counts });
    } catch (error) {
      logger.error('Failed to get workspace activity counts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const activityController = new ActivityController();
