import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { conversationService } from '@/services/conversationService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { MessageType } from '@prisma/client';

const AUTOMATIONS_BOT_ID = 'automations';
const cachedBotUserIdByWorkspace = new Map<string, string>();

async function getAutomationsBotUserId(workspaceId: string): Promise<string> {
  const cached = cachedBotUserIdByWorkspace.get(workspaceId);
  if (cached) return cached;
  const bot = await unifiedBotUserService.getBotByBotId(AUTOMATIONS_BOT_ID, workspaceId);
  if (!bot) {
    throw new Error(
      `[automations] System bot "${AUTOMATIONS_BOT_ID}" not found in workspace ${workspaceId}. Make sure '@/bots/implementations/automations-bot/automations-bot.js' is imported in the bot registry.`,
    );
  }
  cachedBotUserIdByWorkspace.set(workspaceId, bot.id);
  return bot.id;
}

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
    });

    return {
      messageId: result.message.messageId,
      channelId: config.channelId as string,
    };
  }
}

export const sendMessageStep = new SendMessageStep();
