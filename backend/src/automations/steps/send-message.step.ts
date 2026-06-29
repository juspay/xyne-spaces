import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { conversationService } from '@/services/conversationService';
import { MessageType } from '@prisma/client';
import { getAutomationsBotUserId } from './automations-bot';
import { logger } from '@/utils/logger';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';

const SendMessageConfigSchema = z.object({
  channelId: variableRef(z.string().min(1)),
  content: variableRef(z.string().min(1)),
  senderId: variableRef(z.string()).optional(),
});

const SendMessageOutputSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
});

interface SendMessageOutput extends Record<string, unknown> {
  messageId: string;
  channelId: string;
}

export class SendMessageStep extends BaseActionStep<typeof SendMessageConfigSchema, SendMessageOutput> {
  readonly type = 'SEND_MESSAGE';
  readonly configSchema = SendMessageConfigSchema;
  readonly outputSchema = SendMessageOutputSchema;
  readonly name = 'Send a message';
  readonly description = 'Posts a message to the specified channel.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Send';

  async execute(
    config: z.infer<typeof SendMessageConfigSchema>,
    context: AutomationContext,
  ): Promise<SendMessageOutput> {
    const senderId =
      (config.senderId as string | undefined) ??
      (await getAutomationsBotUserId(context.automation.workspaceId));

    const result = await conversationService.createConversationWithMessage({
      channelId: config.channelId as string,
      userId: senderId,
      content: config.content as string,
      msgType:
        config.senderId === undefined ? MessageType.BOT : MessageType.USER,
      isBot: config.senderId === undefined,
      isMarkdown: true,
    });

    // Fire the message side-effect so automation-posted mentions create
    // notifications + activities (and unread counts / app-mention events).
    // conversationService does not trigger this internally, so without it the
    // entire side-effect pipeline is skipped. Mirrors the app/bot path in
    // apps/core/conversationUtils.ts (findOrCreateConversation). The whole
    // block is best-effort: a failure building the query context or dispatching
    // the side-effect must never fail the automation step (the message is
    // already persisted at this point).
    try {
      const ctx = await buildUserQueryContext(senderId);
      const handler = new MessagesSideEffectHandler(ctx);
      handler
        .onInsert({
          entityId: result.message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch((err) =>
          logger.error('[SEND_MESSAGE] Message side-effect handler error', err),
        );
    } catch (err) {
      logger.error(
        '[SEND_MESSAGE] Failed to trigger message side-effects',
        err,
      );
    }

    return {
      messageId: result.message.messageId,
      channelId: config.channelId as string,
    };
  }
}

export const sendMessageStep = new SendMessageStep();
