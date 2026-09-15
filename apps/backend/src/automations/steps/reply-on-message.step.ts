import { z } from 'zod';
import { MessageType, UserType } from '@xyne/shared';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { conversationService } from '@/services/conversationService';
import { db } from '@/database/client';
import { getAutomationsBotUserId } from './automations-bot';
import { logger } from '@/utils/logger';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';
import {
  agentAttachmentsFromContext,
  uploadAgentAttachments,
} from '../services/agent-attachment.service';
import { removeUnclaimedAutomationDeliveryFiles } from '../services/automation-template.service';

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

    // Automations may only post as a non-human (bot/app) identity. Posting as a
    // human user is disallowed (impersonation). Blank sender falls back to the
    // Automations bot above.
    if (config.senderId) {
      const sender = (
        await db.user.findMany({
          where: { id: config.senderId as string, workspaceId: context.automation.workspaceId },
          select: { userType: true },
        })
      )[0];
      if (!sender || sender.userType === UserType.USER) {
        throw new Error(
          `[ReplyOnMessageStep] Sender ${config.senderId} must be a bot or app identity in workspace ${context.automation.workspaceId}. Automations cannot post as a human user; leave the sender empty to post as the Automations bot.`
        );
      }
    }

    const uploadedFiles = await uploadAgentAttachments({
      attachments: agentAttachmentsFromContext(context),
      automationId: context.automation.id,
    });

    let result: Awaited<ReturnType<typeof conversationService.addMessageToConversation>>;
    try {
      result = await conversationService.addMessageToConversation({
        conversationId: config.conversationId as string,
        userId: senderId,
        content: config.content as string,
        msgType: isBot ? MessageType.BOT : MessageType.USER,
        isBot,
        metadata: { contentFormat: 'markdown' },
        uploadedFiles,
      });
    } catch (error) {
      await removeUnclaimedAutomationDeliveryFiles(uploadedFiles);
      throw error;
    }

    // Fire the message side-effect so automation-posted mentions create
    // notifications + activities (and unread counts / app-mention events).
    // conversationService does not trigger this internally, so without it the
    // entire side-effect pipeline is skipped. Mirrors the app/bot reply path in
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
          logger.error(
            '[REPLY_ON_MESSAGE] Message side-effect handler error',
            err,
          ),
        );
    } catch (err) {
      logger.error(
        '[REPLY_ON_MESSAGE] Failed to trigger message side-effects',
        err,
      );
    }

    return {
      messageId: result.message.messageId,
      conversationId: result.conversation.conversationId,
      channelId: result.conversation.channelId,
    };
  }
}

export const replyOnMessageStep = new ReplyOnMessageStep();
