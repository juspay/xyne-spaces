import { EntityUserAccess, ShareableEntityType, ActivityClassification } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

export type RecordingAccessActivityAction =
  | 'recording_shared'
  | 'recording_access_revoked';

export interface RecordingAccessActivity {
  shareId: string;
  action: RecordingAccessActivityAction;
}

/**
 * Publishes the activity-feed entries and user notifications caused by the
 * recording sharing API. Persistence remains owned by RecordingSharingService;
 * this service runs directly after its transaction commits.
 */
export class RecordingSharingNotificationService {
  async publish(actorId: string, changes: RecordingAccessActivity[]): Promise<void> {
    const uniqueChanges = [
      ...new Map(changes.map(change => [`${change.shareId}:${change.action}`, change])).values(),
    ];

    await Promise.all(
      uniqueChanges.map(change =>
        this.publishOne(actorId, change).catch(error => {
          logger.error('[RecordingSharingNotificationService] Failed to publish access change', {
            actorId,
            shareId: change.shareId,
            action: change.action,
            error,
          });
        }),
      ),
    );
  }

  private async publishOne(actorId: string, change: RecordingAccessActivity): Promise<void> {
    const share = await db.entityAccess.findUnique({ where: { id: change.shareId } });
    const isRecordingShare = share?.shareableEntityType === ShareableEntityType.NOTE_TAKER;
    const isCallShare = share?.shareableEntityType === ShareableEntityType.CALL;
    if (!share || (!isRecordingShare && !isCallShare)) return;

    const isRevoked = share.entityUserAccess === EntityUserAccess.REVOKED;
    if (
      (change.action === 'recording_shared' && isRevoked) ||
      (change.action === 'recording_access_revoked' && !isRevoked)
    ) {
      return;
    }

    // Channel access does not have one specific notification recipient.
    if (!share.userId && !share.userGroupId) return;

    const call = await db.call.findUnique({
      where: { id: share.entityId },
      select: { id: true, title: true, createdByUserId: true },
    });
    if (!call) return;

    const recipientIds = share.userId
      ? [share.userId]
      : (
          await db.userGroupMapping.findMany({
            where: { userGroupId: share.userGroupId! },
            select: { userId: true },
          })
        ).map(mapping => mapping.userId);
    const recipients = [...new Set(recipientIds)].filter(
      userId => userId !== actorId && userId !== call.createdByUserId,
    );
    if (recipients.length === 0) return;

    const actor = await repositories.users.findById(actorId);
    const actorName = actor?.name || 'Someone';
    const subject = isRecordingShare ? 'recording' : 'call';
    const recordingTitle = call.title || `a ${subject}`;

    await Promise.all([
      activityService.createActivities(
        recipients.map(userId => ({
          userId,
          actorId,
          actorAction: change.action,
          actionSource: 'call' as const,
          actionSourceId: call.id,
          callId: call.id,
          classification: ActivityClassification.PENDING,
        })),
      ),
      notificationService.createRecordingSharedNotifications(
        recipients,
        call.id,
        recordingTitle,
        actorId,
        actorName,
        change.action,
        subject,
      ),
    ]);
  }
}

export const recordingSharingNotificationService = new RecordingSharingNotificationService();
