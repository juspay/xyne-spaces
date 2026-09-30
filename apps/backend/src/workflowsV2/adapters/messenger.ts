import { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import type {
  XyneSpacesMessageFile,
  XyneSpacesMessenger,
  XyneSpacesOptionsQuery,
  XyneSpacesPostMessageRequest,
  XyneSpacesPostMessageResult,
} from '@xyne/connector-sdk/xyne-spaces';
import type { FieldOption, FieldOptionsPage } from '@xyne/workflow-sdk';
import { MessageType, ProjectType, UserStatus, UserType } from '@xyne/shared';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { removeUnclaimedAutomationDeliveryFiles } from '@/automations/services/automation-template.service';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { conversationService } from '@/services/conversationService';
import type { UploadedFileResult } from '@/services/fileUploadService';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { buildUserQueryContext } from '@/utils/queryContext';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import type { XyneResourceAttrs } from '../types';

const OPTIONS_PAGE_SIZE = 25;

/**
 * Delivers the Xyne Spaces connector's post message step.
 *
 * A copy of the automations "Send a message" step
 * (automations/steps/send-message.step.ts): the same sender rule, recipient
 * filtering, delivery and side effects, so a post behaves the same from either
 * builder. The connector has already checked the config, removed duplicate
 * recipients and read the files.
 */
export class XyneSpacesMessengerAdapter implements XyneSpacesMessenger {
  async postMessage(request: XyneSpacesPostMessageRequest): Promise<XyneSpacesPostMessageResult> {
    const { workspaceId } = request.attributes as XyneResourceAttrs;
    const { executionId, channelId, content } = request;
    const configuredSenderId = request.senderId;
    const senderId = configuredSenderId ?? (await getAutomationsBotUserId(workspaceId));
    const requestedUserIds = [...request.userIds];
    const isBot = configuredSenderId === undefined;
    const msgType = isBot ? MessageType.BOT : MessageType.USER;

    if (configuredSenderId) {
      const senderUsers = await db.user.findMany({
        where: { id: configuredSenderId, workspaceId },
        select: { userType: true },
      });
      const sender = senderUsers[0];
      // Workflows may only post as a non-human (bot/app) identity: posting as a
      // human would let a workflow impersonate them. Blank sender falls back to
      // the Automations bot above.
      if (!sender || sender.userType === UserType.USER) {
        throw new Error(
          `[WorkflowPostMessage] Sender ${configuredSenderId} must be a bot or app identity in workspace ${workspaceId}. Workflows cannot post as a human user; leave the sender empty to post as the Automations bot.`
        );
      }
    }

    // Deliver to a single target — shared by the channel post and each DM so
    // both paths share the same createConversationWithMessage contract.
    const deliver = async (
      targetChannelId: string
    ): Promise<{ messageId: string; channelId: string; conversationId: string }> => {
      const deliveryFiles = await uploadDeliveryFiles(request.files, executionId);
      let result: Awaited<ReturnType<typeof conversationService.createConversationWithMessage>>;
      try {
        result = await conversationService.createConversationWithMessage({
          channelId: targetChannelId,
          userId: senderId,
          content,
          msgType,
          isBot,
          isMarkdown: true,
          uploadedFiles: deliveryFiles,
          emitsMessageReceivedViaSideEffects: true,
        });
      } catch (error) {
        await removeUnclaimedAutomationDeliveryFiles(deliveryFiles);
        throw error;
      }
      const messageId = result.message.messageId;

      // Fire the message side-effect so workflow-posted mentions create
      // notifications + activities (and unread counts / app-mention events).
      // conversationService does not trigger this internally. Best-effort: the
      // message is already persisted, so a failure here must not fail the step.
      try {
        const ctx = await buildUserQueryContext(senderId);
        const handler = new MessagesSideEffectHandler(ctx);
        handler
          .onInsert({
            entityId: messageId,
            entityType: 'messages',
            operation: 'insert',
          })
          .catch((err) =>
            logger.error('[WorkflowPostMessage] Message side-effect handler error', err)
          );
      } catch (err) {
        logger.error('[WorkflowPostMessage] Failed to trigger message side-effects', err);
      }

      return {
        messageId,
        channelId: targetChannelId,
        conversationId: result.conversation.conversationId,
      };
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
        logger.warn('[WorkflowPostMessage] dropped_dm_recipients_not_in_workspace_or_bots', {
          workspaceId,
          executionId,
          droppedCount,
        });
      }

      if (userIds.length === 0) {
        throw new Error(
          `[WorkflowPostMessage] No valid DM recipients: workspaceId=${workspaceId}, executionId=${executionId}`
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
          `[WorkflowPostMessage] DM project not found for workspace: workspaceId=${workspaceId}, executionId=${executionId}`
        );
      }
    }

    // Validate the channel before uploading any files.
    if (channelId) {
      const channelInWorkspace = await db.channel.findFirst({
        where: { id: channelId, workspaceId },
        select: { id: true },
      });
      if (!channelInWorkspace) {
        throw new Error(
          `[WorkflowPostMessage] Channel ${channelId} not found in workspace ${workspaceId}`
        );
      }
    }

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
            throw new Error(
              `[WorkflowPostMessage] DM creation failed for recipient ${recipientUserId}: ${
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
          logger.error('[WorkflowPostMessage] dm_delivery_failed', {
            stage: 'dm_delivery',
            senderId,
            recipientUserId,
            workspaceId,
            executionId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });

      if (failedRecipientIds.length > 0) {
        throw new Error(
          `[WorkflowPostMessage] ${failedRecipientIds.length} of ${userIds.length} DM deliveries failed: workspaceId=${workspaceId}, executionId=${executionId}`
        );
      }
    }

    if (messageIds.length === 0) {
      throw new Error(
        `[WorkflowPostMessage] Message delivery failed for all configured recipients: workspaceId=${workspaceId}, executionId=${executionId}`
      );
    }

    return { messageIds, channelIds, conversationIds };
  }

  async listOptions(query: XyneSpacesOptionsQuery): Promise<FieldOptionsPage> {
    const { workspaceId } = query.attributes as XyneResourceAttrs;
    // Naming ids the editor already holds: answer every one, unpaged and unfiltered.
    const named = query.values ? { id: { in: [...query.values] } } : undefined;
    const search = query.search?.trim();
    const offset = Number.parseInt(query.cursor ?? '0', 10) || 0;
    const skip = named ? undefined : offset;
    const take = named ? undefined : OPTIONS_PAGE_SIZE + 1;

    if (query.kind === 'channel') {
      const where: Prisma.ChannelWhereInput = named
        ? { workspaceId, ...named }
        : {
            workspaceId,
            isArchived: false,
            project: { type: { not: ProjectType.DM } },
            ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
          };
      const channels = await db.channel.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        skip,
        take,
      });
      return toPage(
        channels.map((channel) => ({ value: channel.id, label: channel.name })),
        named ? undefined : offset
      );
    }

    const people = query.kind === 'user';
    const where: Prisma.UserWhereInput = named
      ? { workspaceId, ...named }
      : {
          workspaceId,
          status: UserStatus.ACTIVE,
          userType: people ? UserType.USER : { in: [UserType.BOT, UserType.APP] },
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { displayName: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
    const users = await db.user.findMany({
      where,
      select: { id: true, name: true, displayName: true, email: true, userType: true },
      orderBy: { name: 'asc' },
      skip,
      take,
    });
    return toPage(
      users.map((user) => ({
        value: user.id,
        label: user.displayName ?? user.name,
        ...(people
          ? { description: user.email }
          : { hint: user.userType === UserType.APP ? 'App' : 'Bot' }),
      })),
      named ? undefined : offset
    );
  }
}

/** One page of options, fetched with one extra row to learn whether another page follows. */
function toPage(rows: FieldOption[], offset: number | undefined): FieldOptionsPage {
  if (offset === undefined || rows.length <= OPTIONS_PAGE_SIZE) return { items: rows };
  return {
    items: rows.slice(0, OPTIONS_PAGE_SIZE),
    nextCursor: String(offset + OPTIONS_PAGE_SIZE),
  };
}

/**
 * Uploads a post's files for one delivery, so every message owns its copies. A
 * copy of createAutomationDeliveryFiles for bytes read from workflow storage.
 */
async function uploadDeliveryFiles(
  files: readonly XyneSpacesMessageFile[],
  executionId: string
): Promise<UploadedFileResult[]> {
  const results = await Promise.allSettled(
    files.map(async (file): Promise<UploadedFileResult> => {
      const buffer = Buffer.from(file.bytes);
      const uploadOptions = {
        filename: file.name,
        contentType: file.mimeType,
        scopeType: 'WORKFLOW_DELIVERY',
        scopeId: executionId,
      };
      const upload =
        buffer.byteLength === 0
          ? await storageService.uploadStream(Readable.from(buffer), uploadOptions)
          : await storageService.uploadFile(buffer, uploadOptions);
      return {
        originalName: file.name,
        fileName: file.name,
        fileSize: upload.size,
        mimeType: file.mimeType,
        fileUrl: upload.path,
      };
    })
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed) {
    await Promise.allSettled(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [storageService.deleteFile(result.value.fileUrl)] : []
      )
    );
    throw failed.reason;
  }
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}
