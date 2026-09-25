import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification } from '@xyne/shared';
import type { SideEffectJobConfig } from '../types';
import type { ViewAccessPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';

/**
 * Fires activity feed entries + notifications when a ticket "view"
 * (SavedUserConfiguration) is shared with (insert) or unshared from (delete) a user.
 * View grants are USER-only (no groups/channels/roles), so recipient resolution is
 * simply the grant's entityId.
 */
export class ViewAccessSideEffectHandler extends BaseSideEffectHandler {
  private async notifyAndCreateActivity(params: {
    recipientUserId: string;
    viewId: string;
    actorAction: 'view_shared' | 'view_access_revoked';
    actionSourceId: string;
  }): Promise<void> {
    const { recipientUserId, viewId, actorAction, actionSourceId } = params;

    if (recipientUserId === this.ctx.userID) return;

    const actor = await db.user.findUnique({
      where: { id: this.ctx.userID },
      select: { name: true, displayName: true, id: true },
    });
    const actorName = actor?.displayName || actor?.name || 'Someone';
    const actorId = actor?.id || 'unknown';

    const view = await db.savedUserConfiguration.findUnique({
      where: { id: viewId },
      select: { name: true },
    });
    const viewName = view?.name || 'Untitled view';

    await notificationService.createViewSharedNotifications(
      [recipientUserId],
      viewId,
      viewName,
      actorId,
      actorName,
      actorAction,
    );

    await activityService.createActivities([
      {
        userId: recipientUserId,
        actorAction,
        actionSource: 'view_access',
        actionSourceId,
        actorId: this.ctx.userID,
        workspaceId: this.ctx.workspaceId,
        classification: ActivityClassification.ACTIONABLE,
      },
    ]);
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ViewAccessHandler] onInsert called for entity: ${job.entityId}`);

    try {
      const grant = await db.viewAccess.findUnique({ where: { id: job.entityId } });
      if (!grant) {
        logger.warn(`[ViewAccessHandler] Grant not found for ID: ${job.entityId}`);
        return;
      }

      // Only USER grants exist today; ignore anything else defensively.
      if (grant.entityType !== 'USER') return;

      await this.notifyAndCreateActivity({
        recipientUserId: grant.entityId,
        viewId: grant.viewId,
        actorAction: 'view_shared',
        actionSourceId: grant.viewId,
      });
    } catch (error) {
      logger.error(`[ViewAccessHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ViewAccessHandler] onDelete called for entity: ${job.entityId}`);

    try {
      const previousValue = job.previousValue as ViewAccessPreviousValue | undefined;
      if (!previousValue) {
        logger.warn(`[ViewAccessHandler] No previousValue for deleted grant ID: ${job.entityId}`);
        return;
      }

      if (previousValue.entityType !== 'USER') return;

      await this.notifyAndCreateActivity({
        recipientUserId: previousValue.entityId,
        viewId: previousValue.viewId,
        actorAction: 'view_access_revoked',
        actionSourceId: previousValue.viewId,
      });
    } catch (error) {
      logger.error(`[ViewAccessHandler] Failed to process onDelete for entity ${job.entityId}:`, error);
    }
  }
}
