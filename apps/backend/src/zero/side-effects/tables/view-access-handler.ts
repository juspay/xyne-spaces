import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification, ViewAccessEntityType } from '@xyne/shared';
import type { SideEffectJobConfig } from '../types';
import type { ViewAccessPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';

/**
 * Fires when a saved view is shared (view_access insert) or unshared (delete).
 *
 * A grant targets either a single USER (entityId = userId) or a whole CHANNEL
 * (entityId = channelId, expanded to its current members). For each recipient we
 * create a push notification + an Activity feed entry:
 *   - insert -> 'view_shared'         ("shared a view with you")
 *   - delete -> 'view_access_revoked' ("revoked your access to a view")
 * The actor is always filtered out so nobody is notified about their own action.
 */
export class ViewAccessSideEffectHandler extends BaseSideEffectHandler {
  private async resolveRecipientUserIds(grant: {
    entityType: string;
    entityId: string;
  }): Promise<string[]> {
    if (grant.entityType === ViewAccessEntityType.USER) {
      return [grant.entityId];
    }

    if (grant.entityType === ViewAccessEntityType.CHANNEL) {
      const channelParticipants = await db.channelParticipant.findMany({
        where: { channelId: grant.entityId },
        select: { userId: true },
      });
      return Array.from(new Set(channelParticipants.map(p => p.userId).filter(Boolean)));
    }

    return [];
  }

  private async notifyAndCreateActivities(params: {
    recipientUserIds: string[];
    viewId: string;
    actorAction: 'view_shared' | 'view_access_revoked';
    actionSourceId: string;
    channelId: string | null;
  }): Promise<void> {
    const { recipientUserIds, viewId, actorAction, actionSourceId, channelId } = params;
    const filteredRecipientIds = recipientUserIds.filter(id => id !== this.ctx.userID);
    if (filteredRecipientIds.length === 0) return;

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
      filteredRecipientIds,
      viewId,
      viewName,
      actorId,
      actorName,
      actorAction,
    );

    await activityService.createActivities(
      filteredRecipientIds.map(userId => ({
        userId,
        actorAction,
        actionSource: 'view_access',
        actionSourceId,
        savedViewId: viewId,
        actorId: this.ctx.userID,
        classification: ActivityClassification.ACTIONABLE,
        ...(channelId ? { channelId } : {}),
      })),
    );
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ViewAccessHandler] onInsert called for entity: ${job.entityId}`);

    try {
      const grant = await db.viewAccess.findUnique({ where: { id: job.entityId } });
      if (!grant) {
        logger.warn(`[ViewAccessHandler] Grant not found for ID: ${job.entityId}`);
        return;
      }

      // A USER granting a view to themselves shouldn't self-notify.
      if (grant.entityType === ViewAccessEntityType.USER && grant.entityId === this.ctx.userID) {
        return;
      }

      const recipientUserIds = await this.resolveRecipientUserIds(grant);
      await this.notifyAndCreateActivities({
        recipientUserIds,
        viewId: grant.viewId,
        actorAction: 'view_shared',
        actionSourceId: job.entityId,
        channelId: grant.entityType === ViewAccessEntityType.CHANNEL ? grant.entityId : null,
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

      const { viewId, entityType, entityId } = previousValue;

      if (entityType === ViewAccessEntityType.USER && entityId === this.ctx.userID) {
        return;
      }

      const recipientUserIds = await this.resolveRecipientUserIds({ entityType, entityId });
      await this.notifyAndCreateActivities({
        recipientUserIds,
        viewId,
        actorAction: 'view_access_revoked',
        actionSourceId: job.entityId,
        channelId: entityType === ViewAccessEntityType.CHANNEL ? entityId : null,
      });
    } catch (error) {
      logger.error(`[ViewAccessHandler] Failed to process onDelete for entity ${job.entityId}:`, error);
    }
  }
}
