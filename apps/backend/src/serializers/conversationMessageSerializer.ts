import type { Message, MessageAttachment, SurfaceNudgeCount } from '@prisma/client';
import type { UnreadableString } from '@xyne/shared';

import { type SerializedAttachment, type SerializedNudgeCount } from './conversationV3Serializer';

/**
 * A row as `db` returns it (text) or as `unreadableDb` does (`UnreadableString` in its unreadable
 * fields): the serializer only copies those fields, and unwrapUnreadableResponse sends an
 * `UnreadableString` out as the value it holds.
 */
type MessageRow = Omit<Message, 'content'> & { content: string | UnreadableString };
type AttachmentRow = Omit<MessageAttachment, 'originalFilename'> & { originalFilename: string | UnreadableString };
type ConversationMessageAttachment = Omit<SerializedAttachment, 'originalFilename'> & {
  originalFilename: string | UnreadableString;
};

function toEpochMs(d: Date): number {
  return d.getTime();
}

export interface SerializedConversationMessageRow {
  messageId: string;
  conversationId: string;
  childConversationId: string | null;
  senderId: string;
  content: string | UnreadableString;
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
  attachments: ConversationMessageAttachment[];
  nudgeCounts: SerializedNudgeCount[];
}

function serializeAttachment(attachment: AttachmentRow): ConversationMessageAttachment {
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
  message: MessageRow,
  attachments: AttachmentRow[],
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
