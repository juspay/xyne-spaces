import { z } from 'zod/v3';
import { MessageType } from '@xyne/shared';
import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { conversationService } from '@/services/conversationService';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { logger } from '@/utils/logger';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';
import { repositories } from '@/database/repositories';
import { workspaceOf } from '../context';
import { conversationIssues } from '../validation';
import type { Checked, ConfigIssue } from '../validation';

const ReplyOnMessageConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  content: variableRef(z.string().min(1)),
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
  readonly description = 'Posts a reply, as the Automations bot, into an existing conversation.';
  readonly category = 'messaging';
  readonly icon = 'Reply';

  validateConfig(ctx: Checked<{ conversationId?: string }>): Promise<ConfigIssue[]> {
    return conversationIssues(ctx, 'conversationId', ctx.known.conversationId);
  }

  async execute(
    config: z.infer<typeof ReplyOnMessageConfigSchema>,
    ctx: StepExecutionContext,
  ): Promise<ReplyOnMessageOutput> {
    // The worker runs with no workspace scope, so the conversation must be checked here.
    const workspaceId = workspaceOf(ctx, this.type);
    const conversation = await repositories.conversations.findByIdAndWorkspace(config.conversationId as string, workspaceId);
    if (!conversation) throw new Error(`Conversation ${String(config.conversationId)} not found`);
    const senderId = await getAutomationsBotUserId(workspaceOf(ctx, this.type));

    const result = await conversationService.addMessageToConversation({
      conversationId: config.conversationId as string,
      userId: senderId,
      content: config.content as string,
      msgType: MessageType.BOT,
      isBot: true,
      metadata: { contentFormat: 'markdown' },
      emitsMessageReceivedViaSideEffects: true,
    });

    // Fire the message side-effect so mentions create notifications + activities (and unread counts).
    // conversationService does not trigger this internally. Best-effort: the message is already persisted.
    try {
      const queryCtx = await buildUserQueryContext(senderId);
      new MessagesSideEffectHandler(queryCtx)
        .onInsert({
          entityId: result.message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch((err) => logger.error('[REPLY_ON_MESSAGE] Message side-effect handler error', err));
    } catch (err) {
      logger.error('[REPLY_ON_MESSAGE] Failed to trigger message side-effects', err);
    }

    return {
      messageId: result.message.messageId,
      conversationId: result.conversation.conversationId,
      channelId: result.conversation.channelId,
    };
  }
}
