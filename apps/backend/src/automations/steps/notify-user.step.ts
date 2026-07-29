import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { notificationService } from '@/services/notificationService';
import { NotificationType } from '@prisma/client';
import type { AutomationContext } from '../types/context';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { buildNotifyActionUrl, NOTIFY_LINK_TYPES, type NotifyLinkType } from './notify-action-url';

const NotifyUserConfigSchema = z.object({
  userId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  message: variableRef(z.string().min(1)),
  linkType: z.enum(NOTIFY_LINK_TYPES).default('NONE'),
  linkId: variableRef(z.string()).optional(),
});

const NotifyUserOutputSchema = z.object({
  delivered: z.boolean(),
});

interface NotifyUserOutput extends Record<string, unknown> {
  delivered: boolean;
}

export class NotifyUserStep extends BaseActionStep<typeof NotifyUserConfigSchema, NotifyUserOutput> {
  readonly type = 'NOTIFY_USER';
  readonly configSchema = NotifyUserConfigSchema;
  readonly outputSchema = NotifyUserOutputSchema;
  readonly name = 'Notify a user';
  readonly description = 'Sends an in-app notification to the chosen user.';
  readonly category = StepCategory.USER;
  readonly icon = 'Bell';

  async execute(
    config: z.infer<typeof NotifyUserConfigSchema>,
    context: AutomationContext,
  ): Promise<NotifyUserOutput> {
    const actionUrl = await buildNotifyActionUrl(
      context.automation.workspaceId,
      config.linkType as NotifyLinkType | undefined,
      config.linkId as string | undefined,
    );
    const result = await notificationService.createNotification(config.userId as string, {
      type: NotificationType.MENTION,
      title: config.title as string,
      message: extractPlainTextFromHtml(config.message as string),
      ...(actionUrl ? { actionUrl } : {}),
    });
    return { delivered: result.deliveredViaApp };
  }
}

export const notifyUserStep = new NotifyUserStep();
