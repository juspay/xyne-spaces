import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { appDeskService } from '@/services/appDeskService';
import { logger } from '@/utils/logger';

const SendAppReplyConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  body: variableRef(z.string().min(1)),
});

const SendAppReplyOutputSchema = z.object({
  delivered: z.boolean(),
});

interface SendAppReplyOutput extends Record<string, unknown> {
  delivered: boolean;
}

export class SendAppReplyStep extends BaseActionStep<
  typeof SendAppReplyConfigSchema,
  SendAppReplyOutput
> {
  readonly type = 'SEND_APP_REPLY';
  readonly configSchema = SendAppReplyConfigSchema;
  readonly outputSchema = SendAppReplyOutputSchema;
  readonly name = 'Send an app reply';
  readonly description =
    'Replies on an app-desk conversation. The reply is recorded on the ticket and delivered to the app as a webhook, not as an email.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Reply';

  async execute(
    config: z.infer<typeof SendAppReplyConfigSchema>,
    context: AutomationContext,
  ): Promise<SendAppReplyOutput> {
    const { emailId, delivered } = await appDeskService.sendAppReply({
      conversationId: config.conversationId as string,
      body: config.body as string,
      userId: context.automation.createdById,
    });

    logger.info(
      `[automations] SEND_APP_REPLY conv=${config.conversationId} email=${emailId} delivered=${delivered}`,
    );

    return { delivered };
  }
}

export const sendAppReplyStep = new SendAppReplyStep();
