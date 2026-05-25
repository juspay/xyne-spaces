import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { emailService } from '@/services/emailService';
import { logger } from '@/utils/logger';

const SendEmailReplyConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  body: variableRef(z.string().min(1)),
  replyAll: z.boolean().optional(),
});

const SendEmailReplyOutputSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  conversationId: z.string(),
});

interface SendEmailReplyOutput extends Record<string, unknown> {
  emailId: string;
  threadId: string;
  conversationId: string;
}

export class SendEmailReplyStep extends BaseActionStep<
  typeof SendEmailReplyConfigSchema,
  SendEmailReplyOutput
> {
  readonly type = 'SEND_EMAIL_REPLY';
  readonly configSchema = SendEmailReplyConfigSchema;
  readonly outputSchema = SendEmailReplyOutputSchema;
  readonly name = 'Send an email reply';
  readonly description =
    'Replies to the latest email on the conversation. Body supports {{...}} placeholders. Recipients are derived from the original message.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Mail';

  async execute(
    config: z.infer<typeof SendEmailReplyConfigSchema>,
  ): Promise<SendEmailReplyOutput> {
    const conversationId = config.conversationId as string;
    const body = config.body as string;
    const type = config.replyAll === true ? 'REPLY_ALL' : 'REPLY';

    const result = await emailService.sendReplyOnConversation({
      conversationId,
      body,
      type,
    });

    logger.info(
      `[automations] SEND_EMAIL_REPLY ${type} via ${result.externalSourceType} conv=${conversationId} email=${result.emailId}`,
    );

    return {
      emailId: result.emailId,
      threadId: result.threadId,
      conversationId,
    };
  }
}

export const sendEmailReplyStep = new SendEmailReplyStep();
