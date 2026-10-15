import {
  MessageType,
  TicketStatusV2,
  parseForwardedMessageXml,
  parseInitialMessageMd,
  parseParentMessageMd,
  parseRepliesMd,
  parseTicketMd,
} from '@xyne/shared';

import type { MessageTypeName, TicketPreview } from '../model/chatRow.types';
import type { AttachmentInput, ConversationInput } from '../model/conversationInput';
import { linkPreviewSeedFrom } from '../model/linkPreview';
import { getConversationReactionsMd } from '../model/text/getConversationReactionsMd';
import { htmlToMD } from '../model/text/htmlToMD';
import { isFlowJsonHtml } from '@/src/utils/flowJsonMarkdown';

import {
  DELETED_ATTACHMENT_PLACEHOLDER,
  hasSoftDeletedAttachmentsOnly,
} from '@/src/utils/activeAttachments';

import type { Conversation } from './normalizeConversationWindow';
import { toThreadConversation } from './toThreadConversation';
import { stripHtmlTags } from '@/src/utils/htmlText';

export type ConversationInputContext = {
  channelId: string;
  currentUserId: string;
  isBookmarked: (messageId: string) => boolean;
  /** Thread surface id. Thread rows are MessageItems until converted. */
  threadId?: string;
  /** Index in the thread window. Index 0 keeps the parent replyCount. */
  threadIndex?: number;
};

type AttachmentRow = {
  id?: string;
  mimetype?: string;
  originalFilename?: string;
  size?: number;
  isDeleted?: boolean;
  metadata?: { width?: number; height?: number; duration?: number; thumbUri?: string } | null;
};

const asRecord = (value: Conversation): Record<string, unknown> =>
  value as unknown as Record<string, unknown>;

const str = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

const num = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const asName = (msgType: unknown): MessageTypeName => {
  if (msgType === MessageType.BOT || msgType === 'BOT') {
    return 'BOT';
  }
  if (msgType === MessageType.SYSTEM || msgType === 'SYSTEM') {
    return 'SYSTEM';
  }
  if (msgType === MessageType.FORWARDED || msgType === 'FORWARDED') {
    return 'FORWARDED';
  }
  return 'USER';
};

const asMetadata = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const attachmentsOf = (value: unknown): AttachmentInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): AttachmentInput[] => {
    const row = (item ?? {}) as AttachmentRow;
    if (row.isDeleted === true || !row.id) {
      return [];
    }
    return [
      {
        id: row.id,
        mimetype: row.mimetype ?? 'application/octet-stream',
        ...(row.originalFilename ? { originalFilename: row.originalFilename } : {}),
        ...(typeof row.size === 'number' ? { size: row.size } : {}),
        ...(typeof row.metadata?.width === 'number' ? { width: row.metadata.width } : {}),
        ...(typeof row.metadata?.height === 'number' ? { height: row.metadata.height } : {}),
        ...(typeof row.metadata?.duration === 'number'
          ? { durationSeconds: row.metadata.duration }
          : {}),
        ...(typeof row.metadata?.thumbUri === 'string' ? { thumbUri: row.metadata.thumbUri } : {}),
      },
    ];
  });
};

const stripTicketHtml = (html: string | null | undefined): string =>
  stripHtmlTags((html ?? '').replace(/<br\s*\/?>/gi, '\n'))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .trim();

const ticketStatusLabel = (
  stageName: string | null | undefined,
  statusV2: TicketStatusV2 | null | undefined,
): string => {
  if (stageName?.trim()) return stageName.trim();
  switch (statusV2) {
    case TicketStatusV2.TODO:
      return 'To do';
    case TicketStatusV2.STARTED:
      return 'In progress';
    case TicketStatusV2.PAUSED:
      return 'Paused';
    case TicketStatusV2.CANCELLED:
      return 'Cancelled';
    case TicketStatusV2.COMPLETED:
      return 'Completed';
    default:
      return 'Open';
  }
};

const ticketPreviewOf = (ticketMd: string | null): TicketPreview | null => {
  const ticket = parseTicketMd(ticketMd);
  if (!ticket) {
    return null;
  }
  const description = stripTicketHtml(ticket.description);
  return {
    ticketId: ticket.xyneId?.trim() || ticket.id?.trim() || 'TICKET',
    title: ticket.title?.trim() || description || 'Untitled ticket',
    description: description || null,
    statusLabel: ticketStatusLabel(ticket.stageName, ticket.statusV2),
    priority: typeof ticket.priority === 'string' ? ticket.priority.toUpperCase() : null,
    assigneeId: ticket.assignedTo?.trim() || null,
  };
};

const repliersOf = (repliesMd: string | null): string[] => {
  const parsed = parseRepliesMd(repliesMd);
  const repliers = parsed?.repliers;
  if (!Array.isArray(repliers)) {
    return [];
  }
  return repliers.slice(-3).filter((id): id is string => typeof id === 'string' && id.length > 0);
};

/** Maps a live `useMessages` row onto the L4 input. Null = not visible / unparseable. */
export const toConversationInput = (
  conversation: Conversation,
  ctx: ConversationInputContext,
): ConversationInput | null => {
  const painted = ctx.threadId
    ? toThreadConversation(conversation, ctx.channelId, ctx.threadId, ctx.threadIndex ?? 0)
    : conversation;
  const record = asRecord(painted);
  const initialMd = str(record, 'initial_message_md') ?? str(record, 'initialMessageMd');
  const summary = parseInitialMessageMd(initialMd);
  if (!summary) {
    return null;
  }
  if (
    summary.visibleTo &&
    ctx.currentUserId.length > 0 &&
    summary.visibleTo !== ctx.currentUserId
  ) {
    return null;
  }
  const metadata = asMetadata(summary.metadata);
  const parent = parseParentMessageMd(str(record, 'parent_message_md'));
  const rawHtml = summary.content ?? '';
  const forwarded =
    summary.msgType === MessageType.FORWARDED ? parseForwardedMessageXml(rawHtml) : null;
  const visibleHtml = forwarded ? (forwarded.optionalText ?? '') : rawHtml;
  const softDeletedAttachmentsOnly = hasSoftDeletedAttachmentsOnly(
    Array.isArray(record['initialMessageAttachments'])
      ? (record['initialMessageAttachments'] as ReadonlyArray<{ isDeleted?: boolean }>)
      : [],
  );
  // Attachment-only soft-delete: empty body would otherwise render as "Message".
  const html =
    softDeletedAttachmentsOnly && !stripTicketHtml(visibleHtml)
      ? DELETED_ATTACHMENT_PLACEHOLDER
      : visibleHtml;
  const link = linkPreviewSeedFrom({
    storedMarkdown: summary.link_preview_md ?? null,
    markdown: htmlToMD(html),
  });
  const messageId = summary.messageId ?? str(record, 'initialMessageId') ?? null;
  const conversationId =
    str(record, 'conversationId') ?? str(record, 'conversation_id') ?? summary.conversationId ?? '';
  return {
    conversationId,
    channelId: str(record, 'channelId') || ctx.channelId,
    createdAt: summary.createdAt || num(record, 'createdAt'),
    messageId,
    senderId: summary.senderId || str(record, 'createdBy') || '',
    senderDisplayName: '',
    senderAvatarUri: null,
    messageType: asName(summary.msgType),
    html,
    storedHtml: rawHtml,
    markdown: '',
    isDeleted: summary.isDeleted === true,
    showInChannel: summary.showInChannel === true,
    isVisibleToCurrentUser: true,
    metadata,
    attachments: attachmentsOf(record['initialMessageAttachments']),
    ticketPreview: ticketPreviewOf(str(record, 'ticket_md')),
    parentConversationId: parent?.conversationId ?? null,
    parentMessageId: parent?.messageId ?? null,
    parentMarkdown: parent?.content ?? null,
    replyCount: parent?.conversationId ? 0 : num(record, 'replyCount'),
    latestReplierIds: parent?.conversationId ? [] : repliersOf(str(record, 'replies_md')),
    reactionsMd: getConversationReactionsMd({
      initialMessageMd: initialMd,
      reactionsMd: summary.reactions_md ?? null,
    }),
    linkUrl: link?.url ?? null,
    linkTitle: link?.title ?? null,
    linkDescription: link?.description ?? null,
    linkSiteName: link?.siteName ?? null,
    linkImage: link?.image ?? null,
    linkFavicon: link?.favicon ?? null,
    linkNeedsMetadataFetch: link?.needsMetadataFetch ?? false,
    forwardedFromName: forwarded?.originalSenderName ?? null,
    forwardedSource: forwarded
      ? {
          originalSenderId: forwarded.originalSenderId || null,
          originalCreatedAt: forwarded.originalCreatedAt || null,
          originalChannelId: forwarded.originalChannelId,
          originalConversationId: forwarded.originalConversationId || null,
          originalMessageId: forwarded.originalMessageId || null,
          originalHtml: forwarded.content ?? '',
        }
      : null,
    isPinned: record['pinned'] === true,
    isBookmarked: messageId ? ctx.isBookmarked(messageId) : false,
    isEdited: summary.edited === true,
    isFlowJson: metadata?.['isFlowJson'] === true || isFlowJsonHtml(html),
  };
};
