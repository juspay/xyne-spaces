/**
 * Serialize Conversation to ChannelConversationV3Row format
 * (timestamps as epoch ms, same as @xyne/shared schema).
 */
import type { Conversation, MessageAttachment, SurfaceNudgeCount } from '@prisma/client';

function toEpochMs(d: Date): number {
  return d.getTime();
}

export interface SerializedAttachment {
  id: string;
  entityType: string;
  entityId: string;
  storageProvider: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedByUserId: string;
  createdAt: number;
  url: string;
  createdBy: string;
  metadata: Record<string, unknown> | null;
  conversationId: string | null;
  thumbnailUrl: string | null;
  isDeleted: boolean;
}

export interface SerializedNudgeCount {
  id: string;
  nudgeCount: number;
  userId: string | null;
  channelId: string | null;
  gid: string | null;
  gidType: string | null;
  messageId: string | null;
  ticketId: string | null;
  canvasId: string | null;
  callId: string | null;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SerializedConversationV3Row {
  conversationId: string;
  channelId: string;
  createdBy: string;
  initialMessageId: string;
  parentMessageId: string | null;
  lastActivityAt: number;
  replyCount: number;
  pinned: boolean;
  ticketId: string | null;
  metadata: Record<string, unknown> | null;
  callId: string | null;
  replies_md: string | null;
  ticket_md: string | null;
  initial_message_md: string | null;
  parent_message_md: string | null;
  createdAt: number;
  initialMessageAttachments: SerializedAttachment[];
  initialMessageNudgeCounts: SerializedNudgeCount[];
}

export function serializeConversationV3Row(
  conversation: Conversation,
  attachments: MessageAttachment[],
  nudgeCounts: SurfaceNudgeCount[]
): SerializedConversationV3Row {
  return {
    conversationId: conversation.conversationId,
    channelId: conversation.channelId,
    createdBy: conversation.createdBy,
    initialMessageId: conversation.initialMessageId,
    parentMessageId: conversation.parentMessageId,
    lastActivityAt: toEpochMs(conversation.lastActivityAt),
    replyCount: conversation.replyCount,
    pinned: conversation.pinned,
    ticketId: conversation.ticketId,
    metadata: conversation.metadata as Record<string, unknown> | null,
    callId: conversation.callId,
    replies_md: conversation.replies_md,
    ticket_md: conversation.ticket_md,
    initial_message_md: conversation.initial_message_md,
    parent_message_md: conversation.parent_message_md,
    createdAt: toEpochMs(conversation.createdAt),
    initialMessageAttachments: attachments.map((a): SerializedAttachment => ({
      id: a.id,
      entityType: a.entityType,
      entityId: a.entityId,
      storageProvider: a.storageProvider,
      originalFilename: a.originalFilename,
      mimetype: a.mimetype,
      size: a.size,
      width: a.width,
      height: a.height,
      uploadedByUserId: a.uploadedByUserId,
      createdAt: toEpochMs(a.createdAt),
      url: a.url,
      createdBy: a.createdBy,
      metadata: a.metadata as Record<string, unknown> | null,
      conversationId: a.conversationId,
      thumbnailUrl: a.thumbnailUrl,
      isDeleted: a.isDeleted,
    })),
    initialMessageNudgeCounts: nudgeCounts.map((n): SerializedNudgeCount => ({
      id: n.id,
      nudgeCount: n.nudgeCount,
      userId: n.userId,
      channelId: n.channelId,
      gid: n.gid,
      gidType: n.gidType,
      messageId: n.messageId,
      ticketId: n.ticketId,
      canvasId: n.canvasId,
      callId: n.callId,
      conversationId: n.conversationId,
      createdAt: toEpochMs(n.createdAt),
      updatedAt: toEpochMs(n.updatedAt),
    })),
  };
}