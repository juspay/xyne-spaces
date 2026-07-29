import type { Message, MessageAttachment, SurfaceNudgeCount } from '@prisma/client';

import { type SerializedAttachment, type SerializedNudgeCount } from './conversationV3Serializer';

function toEpochMs(d: Date): number {
  return d.getTime();
}

export interface SerializedConversationMessageRow {
  messageId: string;
  conversationId: string;
  childConversationId: string | null;
  senderId: string;
  content: string;
  msgType: string;
  hasAttachment: boolean;
  edited: boolean;
  isDeleted: boolean;
  showInChannel: boolean;
  visibleTo: string | null;
  createdAt: number;
  metadata: Record<string, unknown> | null;
  nudgeCount: number | null;
  isSent: boolean;
  reactions_md: string | null;
  link_preview_md: string | null;
  attachments: SerializedAttachment[];
  nudgeCounts: SerializedNudgeCount[];
}

function serializeAttachment(attachment: MessageAttachment): SerializedAttachment {
  return {
    id: attachment.id,
    entityType: attachment.entityType,
    entityId: attachment.entityId,
    storageProvider: attachment.storageProvider,
    originalFilename: attachment.originalFilename,
    mimetype: attachment.mimetype,
    size: attachment.size,
    width: attachment.width,
    height: attachment.height,
    uploadedByUserId: attachment.uploadedByUserId,
    createdAt: toEpochMs(attachment.createdAt),
    url: attachment.url,
    createdBy: attachment.createdBy,
    metadata: attachment.metadata as Record<string, unknown> | null,
    conversationId: attachment.conversationId,
    thumbnailUrl: attachment.thumbnailUrl,
    isDeleted: attachment.isDeleted,
  };
}

function serializeNudgeCount(nudgeCount: SurfaceNudgeCount): SerializedNudgeCount {
  return {
    id: nudgeCount.id,
    nudgeCount: nudgeCount.nudgeCount,
    userId: nudgeCount.userId,
    channelId: nudgeCount.channelId,
    gid: nudgeCount.gid,
    gidType: nudgeCount.gidType,
    messageId: nudgeCount.messageId,
    ticketId: nudgeCount.ticketId,
    canvasId: nudgeCount.canvasId,
    callId: nudgeCount.callId,
    conversationId: nudgeCount.conversationId,
    createdAt: toEpochMs(nudgeCount.createdAt),
    updatedAt: toEpochMs(nudgeCount.updatedAt),
  };
}

export function serializeConversationMessageRow(
  message: Message,
  attachments: MessageAttachment[],
  nudgeCounts: SurfaceNudgeCount[]
): SerializedConversationMessageRow {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    childConversationId: message.childConversationId,
    senderId: message.senderId,
    content: message.content,
    msgType: message.msgType,
    hasAttachment: message.hasAttachment,
    edited: message.edited,
    isDeleted: message.isDeleted,
    showInChannel: message.showInChannel,
    visibleTo: message.visibleTo,
    createdAt: toEpochMs(message.createdAt),
    metadata: message.metadata as Record<string, unknown> | null,
    nudgeCount: message.nudgeCount,
    isSent: message.isSent,
    reactions_md: message.reactions_md,
    link_preview_md: message.link_preview_md,
    attachments: attachments.map(serializeAttachment),
    nudgeCounts: nudgeCounts.map(serializeNudgeCount),
  };
}
