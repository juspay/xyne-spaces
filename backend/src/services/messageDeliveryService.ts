import { AttachmentEntityType, MessageType } from '@prisma/client';
import { conversationService } from '@/services/conversationService';
import type { UploadedFileResult } from '@/services/fileUploadService';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { ConversationsSideEffectHandler } from '@/zero/side-effects/tables/conversations-handler';
import type { QueryContext } from '@/zero/acl/core/types';

type DeliverySource =
  | { kind: 'DRAFT'; id: string }
  | { kind: 'DELAYED_MESSAGE'; id: string };

function attachmentEntityTypeForSource(kind: DeliverySource['kind']): AttachmentEntityType {
  return kind === 'DRAFT' ? AttachmentEntityType.DRAFT : AttachmentEntityType.DELAYED_MESSAGE;
}

interface DeliverServerMessageParams {
  senderId: string;
  content: string;
  msgType: MessageType;
  timestamp: number;
  channelId?: string;
  conversationId?: string | null;
  isBot?: boolean;
  source?: DeliverySource;
}

interface DeliverServerMessageResult {
  conversationId: string;
  messageId: string;
}

async function resolveSideEffectCtx(userId: string): Promise<QueryContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      workspaceId: true,
      role: true,
      orgMemberId: true,
    },
  });

  if (!user) {
    throw new Error(`User not found for side-effect context: ${userId}`);
  }

  return {
    userID: user.id,
    workspaceId: user.workspaceId ?? '',
    role: user.role ?? '',
    orgRole: '',
    memberId: user.orgMemberId ?? '',
  };
}

async function runSideEffects(
  userId: string,
  messageId: string,
  conversationId: string,
  createdConversation: boolean,
): Promise<void> {
  try {
    const ctx = await resolveSideEffectCtx(userId);
    const messageHandler = new MessagesSideEffectHandler(ctx);
    await messageHandler.onInsert({
      entityId: messageId,
      entityType: 'messages',
      operation: 'insert',
    });

    if (createdConversation) {
      const conversationHandler = new ConversationsSideEffectHandler(ctx);
      await conversationHandler.onInsert({
        entityId: conversationId,
        entityType: 'conversations',
        operation: 'insert',
      });
    }
  } catch (error) {
    logger.error('[MESSAGE-DELIVERY] Side-effect handler error (non-fatal):', error);
  }
}

/**
 * Fetch attachments for a delivery source (DRAFT or DELAYED_MESSAGE entity rows)
 * and map them into UploadedFileResult so conversationService creates CHAT copies,
 * sets hasAttachment, and queues Vespa like a normal upload.
 */
async function fetchSourceAttachmentsAsUploaded(
  sourceId: string,
  entityType: AttachmentEntityType,
): Promise<UploadedFileResult[]> {
  const attachments = await db.messageAttachment.findMany({
    where: {
      entityId: sourceId,
      entityType,
    },
    select: {
      id: true,
      originalFilename: true,
      size: true,
      mimetype: true,
      url: true,
      thumbnailUrl: true,
      width: true,
      height: true,
      metadata: true,
    },
  });

  return attachments.map((a) => ({
    originalName: a.originalFilename,
    fileName: a.originalFilename,
    fileSize: a.size,
    mimeType: a.mimetype,
    fileUrl: a.url,
    thumbnailUrl: a.thumbnailUrl ?? undefined,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    metadata: (a.metadata as Record<string, unknown>) ?? {},
  }));
}

/**
 * Delete source-entity attachment rows (now duplicated as CHAT on the delivered message)
 * and finalize the source row (draft delete or delayed message SENT).
 */
async function cleanupSourceTransaction(
  senderId: string,
  sourceId: string,
  timestamp: number,
  kind: 'DRAFT' | 'DELAYED_MESSAGE',
): Promise<void> {
  const attachmentEntityType = attachmentEntityTypeForSource(kind);

  await db.$transaction(async (tx) => {
    // Delete old DRAFT attachment rows — conversationService already created the CHAT
    // copies when it processed uploadedFiles.
    await tx.messageAttachment.deleteMany({
      where: {
        entityId: sourceId,
        entityType: attachmentEntityType,
      },
    });

    if (kind === 'DRAFT') {
      const draft = await tx.draftMessage.findUnique({
        where: { id: sourceId },
        select: { id: true, userId: true },
      });
      if (!draft) {
        throw new Error('Draft not found during cleanup');
      }
      if (draft.userId !== senderId) {
        throw new Error('Not authorized to deliver this draft');
      }
      await tx.draftMessage.delete({ where: { id: sourceId } });
      return;
    }

    // DELAYED_MESSAGE
    const delayedMessage = await tx.delayedMessage.findUnique({
      where: { id: sourceId },
      select: { id: true, senderId: true, status: true },
    });

    if (!delayedMessage) {
      throw new Error('Delayed message not found during cleanup');
    }
    if (delayedMessage.senderId !== senderId) {
      throw new Error('Not authorized to deliver this delayed message');
    }
    if (delayedMessage.status !== 'SENDING') {
      throw new Error('Delayed message must be in sending state');
    }

    await tx.delayedMessage.update({
      where: { id: sourceId },
      data: {
        status: 'SENT',
        sentAt: new Date(timestamp),
      },
    });
  });
}

export async function deliverServerMessage(
  params: DeliverServerMessageParams,
): Promise<DeliverServerMessageResult> {
  const {
    senderId,
    content,
    msgType,
    timestamp,
    channelId,
    conversationId,
    isBot = false,
    source,
  } = params;

  const uploadedFiles = source
    ? await fetchSourceAttachmentsAsUploaded(source.id, attachmentEntityTypeForSource(source.kind))
    : [];

  const createdConversation = !conversationId;
  let resolvedConversationId: string;
  let messageId: string;

  if (createdConversation) {
    if (!channelId) {
      throw new Error('channelId is required for new conversation delivery');
    }

    const result = await conversationService.createConversationWithMessage({
      channelId,
      userId: senderId,
      content,
      msgType,
      isBot,
      createdAt: new Date(timestamp),
      uploadedFiles,
    });

    resolvedConversationId = result.conversation.conversationId;
    messageId = result.message.messageId;
  } else {
    const result = await conversationService.addMessageToConversation({
      conversationId,
      userId: senderId,
      content,
      msgType,
      isBot,
      createdAt: new Date(timestamp),
      uploadedFiles,
    });

    resolvedConversationId = result.conversation.conversationId;
    messageId = result.message.messageId;
  }

  // Delete old DRAFT attachment rows and clean up the source (draft delete / delayed SENT).
  if (source) {
    await cleanupSourceTransaction(senderId, source.id, timestamp, source.kind);
  }

  await runSideEffects(senderId, messageId, resolvedConversationId, createdConversation);

  return {
    conversationId: resolvedConversationId,
    messageId,
  };
}

export async function deliverDelayedServerMessage(params: {
  delayedMessageId: string;
  channelId: string;
  conversationId: string | null | undefined;
  senderId: string;
  content: string;
}): Promise<DeliverServerMessageResult> {
  return deliverServerMessage({
    senderId: params.senderId,
    channelId: params.channelId,
    conversationId: params.conversationId,
    content: params.content,
    msgType: MessageType.USER,
    timestamp: Date.now(),
    source: { kind: 'DELAYED_MESSAGE', id: params.delayedMessageId },
  });
}

export async function deliverDraftServerMessage(params: {
  draftId: string;
  senderId: string;
  timestamp: number;
}): Promise<DeliverServerMessageResult> {
  const draft = await db.draftMessage.findUnique({
    where: { id: params.draftId },
    select: {
      id: true,
      userId: true,
      channelId: true,
      conversationId: true,
      content: true,
    },
  });

  if (!draft) {
    throw new Error('Draft not found');
  }
  if (draft.userId !== params.senderId) {
    throw new Error('Not authorized to deliver this draft');
  }

  return deliverServerMessage({
    senderId: params.senderId,
    channelId: draft.channelId,
    conversationId: draft.conversationId,
    content: draft.content,
    msgType: MessageType.USER,
    timestamp: params.timestamp,
    source: { kind: 'DRAFT', id: params.draftId },
  });
}
