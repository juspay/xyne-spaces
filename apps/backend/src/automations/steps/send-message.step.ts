import { z } from 'zod';
import { MessageType, ProjectType, UserType } from '@xyne/shared';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { conversationService } from '@/services/conversationService';
import { repositories } from '@/database/repositories';
import { getAutomationsBotUserId } from './automations-bot';
import { logger } from '@/utils/logger';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';
import { db } from '@/database/client';
import {
  AutomationTemplateAttachmentSchema,
  AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES,
  createAutomationDeliveryFiles,
  prepareRenderedAutomationFiles,
  removeUnclaimedAutomationDeliveryFiles,
} from '../services/automation-template.service';

const MAX_SEND_MESSAGE_RECIPIENTS = 500;

const SendMessageConfigSchema = z
  .object({
    channelId: variableRef(z.string().min(1)).optional(),
    userIds: z.array(variableRef(z.string().min(1))).optional(),
    senderId: variableRef(z.string().min(1)).optional(),
    content: variableRef(z.string().min(1)).optional(),
    attachments: z.array(AutomationTemplateAttachmentSchema).max(10).optional(),
  })
  .refine(
    (data) =>
      (typeof data.content === 'string' && data.content.trim().length > 0) ||
      (data.attachments?.length ?? 0) > 0,
    {
      message: 'Message content or at least one attachment is required',
      path: ['content'],
    }
  )
  .refine(
    (data) =>
      (data.attachments ?? []).reduce((sum, attachment) => sum + attachment.size, 0) <=
      AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES,
    {
      message: 'Total attachment size cannot exceed 25MB',
      path: ['attachments'],
    }
  )
  .refine(
    (data) =>
      data.channelId !== undefined || (data.userIds !== undefined && data.userIds.length > 0),
    {
      message: 'At least one of channel or users must be specified',
      path: ['channelId'],
    }
  );

const SendMessageOutputSchema = z.object({
  messageIds: z.array(z.string()),
  channelIds: z.array(z.string()),
  conversationIds: z.array(z.string()),
  // Singular aliases kept for backward compatibility — existing automations
  // that reference the original `messageId` / `channelId` / `conversationId`
  // outputs resolve to the first delivered target instead of `undefined`.
  messageId: z.string().optional(),
  channelId: z.string().optional(),
  conversationId: z.string().optional(),
});

interface SendMessageOutput extends Record<string, unknown> {
  messageIds: string[];
  channelIds: string[];
  conversationIds: string[];
  messageId?: string;
  channelId?: string;
  conversationId?: string;
}

export class SendMessageStep extends BaseActionStep<
  typeof SendMessageConfigSchema,
  SendMessageOutput
> {
  readonly type = 'SEND_MESSAGE';
  readonly configSchema = SendMessageConfigSchema;
  readonly outputSchema = SendMessageOutputSchema;
  readonly name = 'Send a message';
  readonly description =
    'Posts a message with optional text-template attachments to a channel and/or selected users.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Send';

  async execute(
    config: z.infer<typeof SendMessageConfigSchema>,
    context: AutomationContext
  ): Promise<SendMessageOutput> {
    const configuredSenderId = config.senderId;
    const senderId =
      configuredSenderId ?? (await getAutomationsBotUserId(context.automation.workspaceId));
    const workspaceId = context.automation.workspaceId;
    const automationId = context.automation.id;
    const content = config.content ?? '';
    let preparedFiles: Awaited<ReturnType<typeof prepareRenderedAutomationFiles>> = [];
    const channelId = config.channelId;
    const requestedUserIdsRaw = config.userIds ?? [];
    const uniqueRequestedUserIds = Array.from(new Set(requestedUserIdsRaw));
    const requestedUserIds = uniqueRequestedUserIds.slice(0, MAX_SEND_MESSAGE_RECIPIENTS);
    if (uniqueRequestedUserIds.length > requestedUserIds.length) {
      logger.warn('[SendMessageStep] capped_dm_recipients', {
        workspaceId,
        automationId,
        requestedCount: uniqueRequestedUserIds.length,
        cappedCount: requestedUserIds.length,
      });
    }
    const isBot = configuredSenderId === undefined;
    const msgType = isBot ? MessageType.BOT : MessageType.USER;

    if (configuredSenderId) {
      const senderUsers = await db.user.findMany({
        where: { id: configuredSenderId, workspaceId },
        select: { userType: true },
      });
      const sender = senderUsers[0];
      // Automations may only post as a non-human (bot/app) identity. Posting as
      // a human user is disallowed: it enables impersonation, and the earlier
      // human-only rule both blocked legitimate bot/app senders (e.g. the RCA
      // agent) and silently allowed deactivated humans. Blank sender falls back
      // to the Automations bot above.
      if (!sender || sender.userType === UserType.USER) {
        throw new Error(
          `[SendMessageStep] Sender ${configuredSenderId} must be a bot or app identity in workspace ${workspaceId}. Automations cannot post as a human user; leave the sender empty to post as the Automations bot.`
        );
      }
    }

    // Deliver to a single target — shared by the channel post and each DM so
    // both paths share the same createConversationWithMessage contract.
    const deliver = async (
      channelId: string
    ): Promise<{ messageId: string; channelId: string; conversationId: string }> => {
      const deliveryFiles = await createAutomationDeliveryFiles({
        files: preparedFiles,
        automationId,
      });
      let result: Awaited<ReturnType<typeof conversationService.createConversationWithMessage>>;
      try {
        result = await conversationService.createConversationWithMessage({
          channelId,
          userId: senderId,
          content,
          msgType,
          isBot,
          isMarkdown: true,
          uploadedFiles: deliveryFiles,
        });
      } catch (error) {
        await removeUnclaimedAutomationDeliveryFiles(deliveryFiles);
        throw error;
      }
      const messageId = result.message.messageId;

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
            entityId: messageId,
            entityType: 'messages',
            operation: 'insert',
          })
          .catch((err) => logger.error('[SEND_MESSAGE] Message side-effect handler error', err));
      } catch (err) {
        logger.error('[SEND_MESSAGE] Failed to trigger message side-effects', err);
      }

      return { messageId, channelId, conversationId: result.conversation.conversationId };
    };

    const messageIds: string[] = [];
    const channelIds: string[] = [];
    const conversationIds: string[] = [];
    let userIds: string[] = [];

    if (requestedUserIds.length > 0) {
      const resolvedUsers = await db.user.findMany({
        where: { id: { in: requestedUserIds }, workspaceId },
        select: { id: true, userType: true },
      });
      const allowedUserIds = new Set(
        resolvedUsers
          .filter((user) => user.userType !== UserType.BOT && user.userType !== UserType.APP)
          .map((user) => user.id)
      );
      userIds = requestedUserIds.filter((userId) => allowedUserIds.has(userId));
      const droppedCount = requestedUserIds.length - userIds.length;
      if (droppedCount > 0) {
        logger.warn('[SendMessageStep] dropped_dm_recipients_not_in_workspace_or_bots', {
          workspaceId,
          automationId,
          droppedCount,
        });
      }

      if (userIds.length === 0) {
        throw new Error(
          `[SendMessageStep] No valid DM recipients: workspaceId=${workspaceId}, automationId=${automationId}`
        );
      }

      // Fail fast if the workspace cannot create DMs, instead of letting every
      // per-recipient attempt throw the same generic error.
      const dmProject = await db.project.findFirst({
        where: { workspaceId, code: 'DM', type: ProjectType.DM },
        select: { id: true },
      });
      if (!dmProject) {
        throw new Error(
          `[SendMessageStep] DM project not found for workspace: workspaceId=${workspaceId}, automationId=${automationId}`
        );
      }
    }

    // Validate the channel before rendering/uploading any run-specific files.
    if (channelId) {
      const channelInWorkspace = await db.channel.findFirst({
        where: { id: channelId, workspaceId },
        select: { id: true },
      });
      if (!channelInWorkspace) {
        throw new Error(
          `[SendMessageStep] Channel ${channelId} not found in workspace ${workspaceId}`
        );
      }
    }

    preparedFiles = await prepareRenderedAutomationFiles({
      attachments: config.attachments ?? [],
      context,
    });

    // Post to channel if provided
    if (channelId) {
      const delivered = await deliver(channelId);
      messageIds.push(delivered.messageId);
      channelIds.push(delivered.channelId);
      conversationIds.push(delivered.conversationId);
    }

    // Send DMs to selected users if provided. Each DM is attempted so one
    // recipient failure does not prevent delivery to the rest, but any failed
    // delivery fails the step after all attempts finish.
    if (userIds.length > 0) {
      const dmResults = await Promise.allSettled(
        userIds.map(async (recipientUserId) => {
          try {
            const dmChannelId = await repositories.channels.findOrCreateDMChannel(
              senderId,
              [recipientUserId],
              repositories.channelParticipants,
              workspaceId
            );
            return deliver(dmChannelId);
          } catch (error) {
            // Re-throw with recipient context so logs/stack traces identify
            // exactly which user failed without scanning array indices.
            throw new Error(
              `[SendMessageStep] DM creation failed for recipient ${recipientUserId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        })
      );

      const failedRecipientIds: string[] = [];
      dmResults.forEach((result, index) => {
        const recipientUserId = userIds[index];
        if (result.status === 'fulfilled') {
          messageIds.push(result.value.messageId);
          channelIds.push(result.value.channelId);
          conversationIds.push(result.value.conversationId);
        } else {
          failedRecipientIds.push(recipientUserId);
          logger.error('[SendMessageStep] dm_delivery_failed', {
            stage: 'dm_delivery',
            senderId,
            recipientUserId,
            workspaceId,
            automationId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });

      if (failedRecipientIds.length > 0) {
        throw new Error(
          `[SendMessageStep] ${failedRecipientIds.length} of ${userIds.length} DM deliveries failed: workspaceId=${workspaceId}, automationId=${automationId}`
        );
      }
    }

    if (messageIds.length === 0) {
      const hasConfiguredTarget = channelId || requestedUserIds.length > 0;
      if (hasConfiguredTarget) {
        throw new Error(
          `[SendMessageStep] Message delivery failed for all configured recipients: workspaceId=${workspaceId}, automationId=${automationId}`
        );
      }
      throw new Error(
        `[SendMessageStep] A channel or at least one recipient must be provided: workspaceId=${workspaceId}, automationId=${automationId}`
      );
    }

    // Backward-compatible singular aliases: the first delivered target, so
    // automations referencing the original `messageId` / `channelId` /
    // `conversationId` keep working.
    return {
      messageIds,
      channelIds,
      conversationIds,
      messageId: messageIds[0],
      channelId: channelIds[0],
      conversationId: conversationIds[0],
    };
  }
}

export const sendMessageStep = new SendMessageStep();
