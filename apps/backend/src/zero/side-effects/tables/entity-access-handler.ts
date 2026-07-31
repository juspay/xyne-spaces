import { ActivityClassification, CanvasRole } from '@prisma/client';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ShareableEntityType, EntityUserAccess } from '@xyne/shared';
import { BaseSideEffectHandler } from '../base-handler';
import type { EntityAccessPreviousValue, SideEffectJobConfig } from '../types';

/**
 * Handler for entity_access side effects for NOTE_TAKER (headless call
 * recording) entities.
 *
 * - Direct-user and user-group shares get a notification/activity entry
 *   (channel shares are skipped there — no per-user notification makes sense
 *   for "shared with a whole channel").
 * - ALL share types (user/group/channel) get their access mirrored into
 *   canvas_participants for the recording's notes + detailed-summary
 *   canvases, since those canvases are now PRIVATE and gate access
 *   independently of entity_access.
 */
export class EntityAccessSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    await Promise.all([
      this.notify(job.entityId, 'recording_shared'),
      this.syncCanvasAccess(job.entityId, 'grant'),
    ]);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const previous = job.previousValue as EntityAccessPreviousValue | undefined;
    const wasRevoked = previous?.entityUserAccess === EntityUserAccess.REVOKED;

    const share = await db.entityAccess.findUnique({ where: { id: job.entityId } });
    if (!share) return;
    const isNowRevoked = share.entityUserAccess === EntityUserAccess.REVOKED;

    if (wasRevoked && !isNowRevoked) {
      // Re-shared after a previous revoke — treat like a fresh share.
      await Promise.all([
        this.notify(job.entityId, 'recording_shared'),
        this.syncCanvasAccess(job.entityId, 'grant'),
      ]);
    } else if (!wasRevoked && isNowRevoked) {
      // Access was just removed — let the affected recipient(s) know.
      await Promise.all([
        this.notify(job.entityId, 'recording_access_revoked'),
        this.syncCanvasAccess(job.entityId, 'revoke'),
      ]);
    }
    // Any other update (e.g. no-op, or a fresh revoke of an already-revoked
    // row) is not notification-worthy.
  }

  /**
   * Mirrors a NOTE_TAKER entity_access row into canvas_participants for the
   * call's notes/detailed-summary canvases (read from Call.metadata). Runs
   * as raw Prisma (not a Zero mutation), so it isn't subject to
   * CanvasParticipantsACL — this handler only fires after shareRecording/
   * updateRecordingShare already authorized the caller (owner or workspace
   * admin) at the recording level.
   */
  private async syncCanvasAccess(shareId: string, action: 'grant' | 'revoke'): Promise<void> {
    try {
      const share = await db.entityAccess.findUnique({ where: { id: shareId } });
      if (!share || share.shareableEntityType !== ShareableEntityType.NOTE_TAKER) {
        return;
      }

      const isRevoke = action === 'revoke';
      const isNowRevoked = share.entityUserAccess === EntityUserAccess.REVOKED;
      if (isRevoke ? !isNowRevoked : isNowRevoked) {
        // Stale/racy read — actual row state doesn't match the action being applied.
        return;
      }

      const call = await db.call.findUnique({
        where: { id: share.entityId },
        select: { workspaceId: true, metadata: true },
      });
      if (!call?.workspaceId) return;

      const metadata = (call.metadata as Record<string, unknown> | null) ?? {};
      const canvasIds = [metadata['notesCanvasId'], metadata['detailedSummaryCanvasId']].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
      if (canvasIds.length === 0) return;

      const workspaceId = call.workspaceId;

      for (const canvasId of canvasIds) {
        if (share.userId) {
          const userId = share.userId;
          if (action === 'grant') {
            await db.canvasParticipant.upsert({
              where: { canvasId_userId: { canvasId, userId } },
              create: { canvasId, workspaceId, userId, role: CanvasRole.VIEWER },
              update: {},
            });
          } else {
            await db.canvasParticipant.deleteMany({ where: { canvasId, userId } });
          }
        } else if (share.userGroupId) {
          const userGroupId = share.userGroupId;
          if (action === 'grant') {
            await db.canvasParticipant.upsert({
              where: { canvasId_userGroupId: { canvasId, userGroupId } },
              create: { canvasId, workspaceId, userGroupId, role: CanvasRole.VIEWER },
              update: {},
            });
          } else {
            await db.canvasParticipant.deleteMany({ where: { canvasId, userGroupId } });
          }
        } else if (share.channelId) {
          const channelId = share.channelId;
          if (action === 'grant') {
            await db.canvasParticipant.upsert({
              where: { canvasId_channelId: { canvasId, channelId } },
              create: { canvasId, workspaceId, channelId, role: CanvasRole.VIEWER },
              update: {},
            });
          } else {
            await db.canvasParticipant.deleteMany({ where: { canvasId, channelId } });
          }
        }
      }
    } catch (error) {
      logger.error('[EntityAccessSideEffectHandler] Failed to sync canvas participant access:', error);
      // Don't throw - we don't want to fail the share mutation.
    }
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
