import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { conversationService } from '@/services/conversationService';
import { MessageType } from '@prisma/client';
import { getAutomationsBotUserId } from './automations-bot';

const ReplyOnMessageConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  content: variableRef(z.string().min(1)),
  senderId: variableRef(z.string()).optional(),
});

const ReplyOnMessageOutputSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
});

interface ReplyOnMessageOutput extends Record<string, unknown> {
  messageId: string;
  conversationId: string;
  channelId: string;
}

export class ReplyOnMessageStep extends BaseActionStep<
  typeof ReplyOnMessageConfigSchema,
  ReplyOnMessageOutput
> {
  readonly type = 'REPLY_ON_MESSAGE';
  readonly configSchema = ReplyOnMessageConfigSchema;
  readonly outputSchema = ReplyOnMessageOutputSchema;
  readonly name = 'Reply on a message';
  readonly description = 'Posts a reply into an existing conversation.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Reply';

  async execute(
    config: z.infer<typeof ReplyOnMessageConfigSchema>,
    context: AutomationContext,
  ): Promise<ReplyOnMessageOutput> {
    const isBot = config.senderId === undefined;
    const senderId =
      (config.senderId as string | undefined) ??
      (await getAutomationsBotUserId(context.automation.workspaceId));

    const result = await conversationService.addMessageToConversation({
      conversationId: config.conversationId as string,
      userId: senderId,
      content: config.content as string,
      msgType: isBot ? MessageType.BOT : MessageType.USER,
      isBot,
    });

    return {
      messageId: result.message.messageId,
      conversationId: result.conversation.conversationId,
      channelId: result.conversation.channelId,
    };
  }
}

export const replyOnMessageStep = new ReplyOnMessageStep();
