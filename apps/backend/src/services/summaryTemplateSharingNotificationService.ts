import { ActivityClassification, EntityUserAccess, ShareableEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

export type SummaryTemplateAccessActivityAction =
  | 'summary_template_shared'
  | 'summary_template_access_revoked';

export interface SummaryTemplateAccessActivity {
  shareId: string;
  action: SummaryTemplateAccessActivityAction;
}

export class SummaryTemplateSharingNotificationService {
  async publish(actorId: string, changes: SummaryTemplateAccessActivity[]): Promise<void> {
    const uniqueChanges = [
      ...new Map(changes.map((change) => [`${change.shareId}:${change.action}`, change])).values(),
    ];
    await Promise.all(
      uniqueChanges.map((change) =>
        this.publishOne(actorId, change).catch((error) => {
          logger.error('[SummaryTemplateSharingNotificationService] Failed to publish change', {
            actorId,
            ...change,
            error,
          });
        })
      )
    );
  }

  private async publishOne(actorId: string, change: SummaryTemplateAccessActivity): Promise<void> {
    const share = await db.entityAccess.findUnique({ where: { id: change.shareId } });
    if (!share || share.shareableEntityType !== ShareableEntityType.SUMMARY_TEMPLATE) return;

    const isRevoked = share.entityUserAccess === EntityUserAccess.REVOKED;
    if (
      (change.action === 'summary_template_shared' && isRevoked) ||
      (change.action === 'summary_template_access_revoked' && !isRevoked)
    ) {
      return;
    }
    if (!share.userId && !share.userGroupId) return;

    const template = await db.summaryTemplate.findUnique({ where: { id: share.entityId } });
    if (!template) return;
    const recipientIds = share.userId
      ? [share.userId]
      : (
          await db.userGroupMapping.findMany({
            where: { userGroupId: share.userGroupId! },
            select: { userId: true },
          })
        ).map((mapping) => mapping.userId);
    const recipients = [...new Set(recipientIds)].filter(
      (userId) => userId !== actorId && userId !== template.createdBy
    );
    if (recipients.length === 0) return;

    const actor = await repositories.users.findById(actorId);
    const actorName = actor?.name || 'Someone';
    await Promise.all([
      activityService.createActivities(
        recipients.map((userId) => ({
          userId,
          workspaceId: template.workspaceId,
          actorId,
          actorAction: change.action,
          actionSource: 'summary_template',
          actionSourceId: template.id,
          classification: ActivityClassification.PENDING,
        }))
      ),
      notificationService.createSummaryTemplateSharedNotifications(
        recipients,
        template.id,
        template.name,
        template.workspaceId,
        actorId,
        actorName,
        change.action
      ),
    ]);
  }
}

export const summaryTemplateSharingNotificationService =
  new SummaryTemplateSharingNotificationService();
