import { z } from 'zod';
import { NotificationType } from '@prisma/client';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const NotifyGroupConfigSchema = z.object({
  groupId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  message: variableRef(z.string().min(1)),
  actionUrl: variableRef(z.string()).optional(),
});

const NotifyGroupOutputSchema = z.object({
  groupId: z.string(),
  recipientCount: z.number(),
  deliveredCount: z.number(),
});

interface NotifyGroupOutput extends Record<string, unknown> {
  groupId: string;
  recipientCount: number;
  deliveredCount: number;
}

export class NotifyGroupStep extends BaseActionStep<
  typeof NotifyGroupConfigSchema,
  NotifyGroupOutput
> {
  readonly type = 'NOTIFY_GROUP';
  readonly configSchema = NotifyGroupConfigSchema;
  readonly outputSchema = NotifyGroupOutputSchema;
  readonly name = 'Notify a user group';
  readonly description = 'Sends an in-app notification to every active member of the chosen group.';
  readonly category = StepCategory.USER;
  readonly icon = 'Users';

  async execute(
    config: z.infer<typeof NotifyGroupConfigSchema>,
  ): Promise<NotifyGroupOutput> {
    const groupId = config.groupId as string;
    const title = config.title as string;
    const message = config.message as string;
    const actionUrl = config.actionUrl as string | undefined;

    const group = await repositories.userGroups.findWithMappings(groupId);
    if (!group) {
      throw new Error(`[NOTIFY_GROUP] User group not found: ${groupId}`);
    }
    const memberIds = (group.userGroupMappings ?? [])
      .map(m => m.user?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (memberIds.length === 0) {
      logger.info(`[automations] NOTIFY_GROUP group=${groupId} has no members — skipping`);
      return { groupId, recipientCount: 0, deliveredCount: 0 };
    }

    let delivered = 0;
    for (const userId of memberIds) {
      try {
        const result = await notificationService.createNotification(userId, {
          type: NotificationType.MENTION,
          title,
          message,
          ...(actionUrl ? { actionUrl } : {}),
        });
        if (result.deliveredViaApp) delivered += 1;
      } catch (err) {
        logger.warn(
          `[automations] NOTIFY_GROUP individual notification failed (group=${groupId}, user=${userId}):`,
          err,
        );
      }
    }

    logger.info(
      `[automations] NOTIFY_GROUP group=${groupId} delivered=${delivered}/${memberIds.length}`,
    );

    return {
      groupId,
      recipientCount: memberIds.length,
      deliveredCount: delivered,
    };
  }
}

export const notifyGroupStep = new NotifyGroupStep();
