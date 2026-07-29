import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { notificationService } from '@/services/notificationService';
import { NotificationType } from '@prisma/client';
import type { AutomationContext } from '../types/context';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { buildNotifyActionUrl, NOTIFY_LINK_TYPES, type NotifyLinkType } from './notify-action-url';
import { repositories } from '@/database/repositories';

const NotifyUserSosConfigSchema = z.object({
  userId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  message: variableRef(z.string().min(1)),
  linkType: z.enum(NOTIFY_LINK_TYPES).default('NONE'),
  linkId: variableRef(z.string()).optional(),
});

const NotifyUserSosOutputSchema = z.object({
  delivered: z.boolean(),
});

interface NotifyUserSosOutput extends Record<string, unknown> {
  delivered: boolean;
}

/**
 * SOS variant of NOTIFY_USER for safety-critical escalations
 */
export class NotifyUserSosStep extends BaseActionStep<
  typeof NotifyUserSosConfigSchema,
  NotifyUserSosOutput
> {
  readonly type = 'NOTIFY_USER_SOS';
  readonly configSchema = NotifyUserSosConfigSchema;
  readonly outputSchema = NotifyUserSosOutputSchema;
  readonly name = 'SOS alert a user';
  readonly description =
    'Sends an urgent SOS alert that persists on screen with a siren sound until the user acknowledges it.';
  readonly category = StepCategory.USER;
  readonly icon = 'Siren';

  async execute(
    config: z.infer<typeof NotifyUserSosConfigSchema>,
    context: AutomationContext,
  ): Promise<NotifyUserSosOutput> {
    const userId = config.userId as string;
    const workspaceId = context.automation.workspaceId;
    const user = await repositories.users.findById(userId);
    if (!user) {
      throw new Error(`[NOTIFY_USER_SOS] User ${userId} not found`);
    }
    if (user.workspaceId !== workspaceId) {
      throw new Error(`[NOTIFY_USER_SOS] User ${userId} does not belong to workspace ${workspaceId}`);
    }

    const actionUrl = await buildNotifyActionUrl(
      context.automation.workspaceId,
      config.linkType as NotifyLinkType | undefined,
      config.linkId as string | undefined,
    );
    const result = await notificationService.createNotification(userId, {
      type: NotificationType.MENTION,
      title: config.title as string,
      message: extractPlainTextFromHtml(config.message as string),
      ...(actionUrl ? { actionUrl } : {}),
      metadata: {
        // Clients branch on this to show the persistent SOS banner + siren.
        notificationType: 'sos_alert',
      },
    });
    return { delivered: result.deliveredViaApp };
  }
}

export const notifyUserSosStep = new NotifyUserSosStep();
