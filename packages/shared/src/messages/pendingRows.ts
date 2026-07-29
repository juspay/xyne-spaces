import type {
  Conversation,
  ThreadConversation,
} from '../machines/queryCacheMachine.js';
import { serializeInitialMessageMd } from '../utils/activityMetadataParser.js';
import { AttachmentEntityType } from '../zero/schema.js';
import type { PendingAttachment, PendingMessage } from './pending.js';

type ThreadMessage = ThreadConversation['messages'][number];

type AttachmentRow = NonNullable<Conversation['initialMessageAttachments']>[number];

function buildAttachmentRows(
  entry: PendingMessage,
): AttachmentRow[] {
  const attachments: PendingAttachment[] = entry.attachments ?? [];
  return attachments.map((att, idx) => ({
    id: att.attachmentId,
    entityType: AttachmentEntityType.CHAT,
    entityId: entry.messageId,
    workspaceId: entry.workspaceId ?? '',
    storageProvider: '',
    originalFilename: att.originalFilename,
    mimetype: att.mimetype,
    size: att.size,
    ...(att.width !== undefined && { width: att.width }),
    ...(att.height !== undefined && { height: att.height }),
    uploadedByUserId: entry.senderId,
    createdAt: entry.timestamp + idx,
    url: '',
    createdBy: entry.senderId,
    metadata: att.duration !== undefined ? { duration: att.duration } : null,
    conversationId: entry.conversationId,
    thumbnailUrl: undefined,
    isDeleted: false,
    uploadStatus: undefined,
  } as unknown as AttachmentRow));
}

/**
 * Byte-for-byte match Zero's optimistic conversation insert
 * (mutators.conversations.send). Same field values → when the pending entry
 * is removed after `isSent`, React sees the same conversationId key with
 * identical content and swaps in place — no flicker.
 */
export function buildPendingChannelConversation(
  entry: PendingMessage,
): Conversation {
  const attachmentRows = buildAttachmentRows(entry);
  const hasAttachment = attachmentRows.length > 0;

  const initial_message_md = serializeInitialMessageMd({
    messageId: entry.messageId,
    conversationId: entry.conversationId,
    workspaceId: entry.workspaceId,
    senderId: entry.senderId,
    content: entry.content,
    msgType: entry.type,
    hasAttachment,
    edited: false,
    isDeleted: false,
    showInChannel: false,
    visibleTo: null,
    createdAt: entry.timestamp,
    metadata: null,
    nudgeCount: null,
    isSent: false,
    reactions_md: null,
    link_preview_md: null,
    childConversationId: null,
  });

  return {
    conversationId: entry.conversationId,
    channelId: entry.channelId,
    workspaceId: entry.workspaceId,
    createdBy: entry.senderId,
    initialMessageId: entry.messageId,
    parentMessageId: null,
    lastActivityAt: entry.timestamp,
    replyCount: 0,
    pinned: false,
    ticketId: null,
    metadata: {},
    callId: null,
    replies_md: null,
    ticket_md: null,
    initial_message_md,
    parent_message_md: null,
    doNotPostToChannel: null,
    createdAt: entry.timestamp,
    initialMessageAttachments: attachmentRows,
    initialMessageNudgeCounts: [],
  } as unknown as Conversation;
}

/**
 * Byte-for-byte match Zero's optimistic message insert
 * (mutators.messages.send). See buildPendingChannelConversation for the
 * no-flicker rationale.
 */
export function buildPendingThreadMessage(entry: PendingMessage): ThreadMessage {
  const attachmentRows = buildAttachmentRows(entry);
  return {
    messageId: entry.messageId,
    conversationId: entry.conversationId,
    workspaceId: entry.workspaceId,
    senderId: entry.senderId,
    content: entry.content,
    msgType: entry.type,
    hasAttachment: attachmentRows.length > 0,
    edited: false,
    isSent: false,
    isDeleted: false,
    showInChannel: entry.alsoSendToChannel ?? false,
    childConversationId: entry.childConversationId ?? null,
    createdAt: entry.timestamp,
    metadata: null,
    attachments: attachmentRows,
    nudgeCounts: [],
  } as unknown as ThreadMessage;
}
