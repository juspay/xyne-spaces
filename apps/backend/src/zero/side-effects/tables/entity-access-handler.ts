import { ActivityClassification } from '@prisma/client';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ShareableEntityType, EntityUserAccess } from '@xyne/shared';
import { BaseSideEffectHandler } from '../base-handler';
import type { EntityAccessPreviousValue, SideEffectJobConfig } from '../types';

/**
 * Handler for entity_access side effects. Currently only handles direct-user
 * and user-group shares of NOTE_TAKER (headless call recording) entities —
 * channel shares are intentionally skipped (no per-user notification/activity
 * makes sense for "shared with a whole channel").
 */
export class EntityAccessSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    await this.notify(job.entityId, 'recording_shared');
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const previous = job.previousValue as EntityAccessPreviousValue | undefined;
    const wasRevoked = previous?.entityUserAccess === EntityUserAccess.REVOKED;

    const share = await db.entityAccess.findUnique({ where: { id: job.entityId } });
    if (!share) return;
    const isNowRevoked = share.entityUserAccess === EntityUserAccess.REVOKED;

    if (wasRevoked && !isNowRevoked) {
      // Re-shared after a previous revoke — treat like a fresh share.
      await this.notify(job.entityId, 'recording_shared');
    } else if (!wasRevoked && isNowRevoked) {
      // Access was just removed — let the affected recipient(s) know.
      await this.notify(job.entityId, 'recording_access_revoked');
    }
    // Any other update (e.g. no-op, or a fresh revoke of an already-revoked
    // row) is not notification-worthy.
  }

  private async notify(
    shareId: string,
    actorAction: 'recording_shared' | 'recording_access_revoked',
  ): Promise<void> {
    try {
      const share = await db.entityAccess.findUnique({ where: { id: shareId } });

      if (!share) {
        logger.warn(`[EntityAccessSideEffectHandler] Share ${shareId} not found`);
        return;
      }

      if (share.shareableEntityType !== ShareableEntityType.NOTE_TAKER) {
        return;
      }

      const isRevokeAction = actorAction === 'recording_access_revoked';
      if (isRevokeAction ? share.entityUserAccess !== EntityUserAccess.REVOKED : share.entityUserAccess === EntityUserAccess.REVOKED) {
        // State doesn't match the action being notified — stale/racy read, skip.
        return;
      }

      // Channel shares: no single-user notification/activity to create.
      if (!share.userId && !share.userGroupId) {
        return;
      }

      const call = await db.call.findUnique({
        where: { id: share.entityId },
        select: { id: true, title: true, createdByUserId: true },
      });

      if (!call) {
        logger.warn(`[EntityAccessSideEffectHandler] Call ${share.entityId} not found for share ${shareId}`);
        return;
      }

      const actorId = this.ctx.userID;

      let recipientIds: string[];
      if (share.userId) {
        recipientIds = [share.userId];
      } else {
        const mappings = await db.userGroupMapping.findMany({
          where: { userGroupId: share.userGroupId! },
          select: { userId: true },
        });
        recipientIds = mappings.map(m => m.userId);
      }

      recipientIds = [...new Set(recipientIds)].filter(
        id => id !== actorId && id !== call.createdByUserId,
      );

      if (recipientIds.length === 0) {
        return;
      }

      const actor = await repositories.users.findById(actorId);
      const actorName = actor?.name || 'Someone';
      const recordingTitle = call.title || 'a recording';

      const activities = recipientIds.map(userId => ({
        userId,
        actorId,
        actorAction,
        actionSource: 'call' as const,
        actionSourceId: call.id,
        callId: call.id,
        classification: ActivityClassification.PENDING,
      }));

      logger.info(`[EntityAccessSideEffectHandler] Creating ${activities.length} activity/notification entries (${actorAction}) for recording share ${shareId}`, {
        callId: call.id,
        recipientIds,
      });

      await Promise.all([
        activityService.createActivities(activities),
        notificationService.createRecordingSharedNotifications(
          recipientIds,
          call.id,
          recordingTitle,
          actorId,
          actorName,
          actorAction,
        ),
      ]).catch(error => {
        logger.error('[EntityAccessSideEffectHandler] Failed to create activities or send recording-share notifications:', error);
      });
    } catch (error) {
      logger.error('[EntityAccessSideEffectHandler] Failed to handle entity_access change:', error);
      // Don't throw - we don't want to fail the share mutation.
    }
  }
}
