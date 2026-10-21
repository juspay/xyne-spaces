import { z } from 'zod';
import { convert as htmlToText } from 'html-to-text';
import { EmailType } from '@xyne/shared';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { getAutomationsBotUserId } from './automations-bot';
// Registers the review adapters socialMediaService.reply sends through, as the sync worker does.
import '@/integrations/adapters/social-media';
import { db } from '@/database/client';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { logger } from '@/utils/logger';

const SendReviewReplyConfigSchema = z.object({
  conversationId: variableRef(
    z.string().min(1).describe('The review to reply to, e.g. {{trigger.email.conversationId}}.'),
  ),
  body: variableRef(
    z.string().describe('Reply text, e.g. an Ask Jev answer\'s text. Sent as plain text; Google Play allows 350 characters.'),
  ),
});

const SendReviewReplyOutputSchema = z.object({
  sent: z.boolean(),
  /** Why nothing was sent, e.g. "already-replied". */
  skippedReason: z.string().nullable(),
  /** The reply on the ticket: the one just sent, or the existing one when skipped. */
  replyId: z.string().nullable(),
});

interface SendReviewReplyOutput extends Record<string, unknown> {
  sent: boolean;
  skippedReason: string | null;
  replyId: string | null;
}

/** Stores take plain text; a rich-text value would otherwise post its tags. */
const toPlainText = (value: string): string =>
  (/<[a-z][\s\S]*>/i.test(value) ? htmlToText(value, { wordwrap: false }) : value).trim();

export class SendReviewReplyStep extends BaseActionStep<
  typeof SendReviewReplyConfigSchema,
  SendReviewReplyOutput
> {
  readonly type = 'SEND_REVIEW_REPLY';
  readonly configSchema = SendReviewReplyConfigSchema;
  readonly outputSchema = SendReviewReplyOutputSchema;
  readonly name = 'Send review reply';
  readonly description =
    'Posts a public reply to a Google Play or App Store review, the same way the Send button does, as the Automations bot. Skips reviews that already have a reply.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Send';

  async execute(
    config: z.infer<typeof SendReviewReplyConfigSchema>,
    context: AutomationContext,
  ): Promise<SendReviewReplyOutput> {
    const conversationId = config.conversationId as string;
    const workspaceId = context.automation.workspaceId;
    const body = toPlainText((config.body as string | undefined) ?? '');
    if (!body) throw new Error('The reply text is empty, so nothing was sent');

    // One reply per review: a second send overwrites on Google Play and is refused by the App Store.
    const existing = await db.email.findFirst({
      where: { conversationId, workspaceId, type: EmailType.REPLY },
      select: { id: true },
    });
    if (existing) {
      logger.info('[automations] SEND_REVIEW_REPLY skipped, the review already has a reply', {
        conversationId,
      });
      return { sent: false, skippedReason: 'already-replied', replyId: existing.id };
    }

    const userId = await getAutomationsBotUserId(workspaceId);
    const reply = await socialMediaService.reply({ conversationId, workspaceId, userId, body });
    return { sent: true, skippedReason: null, replyId: reply.id };
  }
}

export const sendReviewReplyStep = new SendReviewReplyStep();
