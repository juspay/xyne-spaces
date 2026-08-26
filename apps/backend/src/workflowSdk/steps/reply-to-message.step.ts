// REPLY_TO_MESSAGE step for the v2 workflow engine — posts a reply into a
// conversation as the Automations bot.
//
// Deliberately mirrors the automations engine's REPLY_ON_MESSAGE step
// (src/automations/steps/reply-on-message.step.ts): same conversationService
// call, same bot identity, same side-effect dispatch — so mentions, unread
// counts and notifications behave identically whichever engine posted.

import { z } from 'zod';
import { MessageType } from '@xyne/shared';
import { BaseActionStep, type StepExecutionContext } from '@xyne/workflow-sdk';
import { conversationService } from '@/services/conversationService';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';
import { logger } from '@/utils/logger';
import type { XyneResourceAttrs } from '../acl';

const ConfigSchema = z.object({
  /** Conversation to reply in — usually {{trigger.conversationId}}. */
  conversationId: z.string().min(1),
  /** Reply body (markdown). */
  content: z.string().min(1),
});

const OutputSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
});

interface ReplyOutput extends Record<string, unknown> {
  messageId: string;
  conversationId: string;
  channelId: string;
}

export class ReplyToMessageStep extends BaseActionStep<typeof ConfigSchema, ReplyOutput> {
  readonly type = 'REPLY_TO_MESSAGE';
  readonly configSchema = ConfigSchema;
  readonly outputSchema = OutputSchema;
  readonly name = 'Reply to message';
  readonly description = 'Posts a reply into a space conversation as the Automations bot.';
  readonly category = 'messaging';
  readonly icon = 'Reply';

  async execute(
    config: z.infer<typeof ConfigSchema>,
    ctx: StepExecutionContext,
  ): Promise<ReplyOutput> {
    // Workflows post as a non-human identity only — never as a real user.
    const attrs = ctx.runtime.attributes as XyneResourceAttrs;
    const senderId = await getAutomationsBotUserId(attrs.workspaceId);

    const result = await conversationService.addMessageToConversation({
      conversationId: config.conversationId,
      userId: senderId,
      content: config.content,
      msgType: MessageType.BOT,
      isBot: true,
      metadata: { contentFormat: 'markdown' },
    });

    // conversationService does not run the message side-effect pipeline itself,
    // so mentions/notifications/unread counts would be skipped without this.
    // Best-effort: the message is already persisted, so a side-effect failure
    // must not fail the step.
    try {
      const queryCtx = await buildUserQueryContext(senderId);
      void new MessagesSideEffectHandler(queryCtx)
        .onInsert({
          entityId: result.message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch(err => logger.error('[WORKFLOW-SDK] REPLY_TO_MESSAGE side-effect failed', err));
    } catch (err) {
      logger.error('[WORKFLOW-SDK] REPLY_TO_MESSAGE side-effect setup failed', err);
    }

    return {
      messageId: result.message.messageId,
      conversationId: result.conversation.conversationId,
      channelId: result.conversation.channelId,
    };
  }
}
