import type { ChannelScopeType } from '@xyne/shared';

export type SenderPaintModel = {
  senderId: string;
  displayName: string;
  avatarUri: string | null;
  isCurrentUser: boolean;
};

export type TicketPreview = {
  ticketId: string;
  title: string;
  description: string | null;
  statusLabel: string;
  priority: string | null;
  assignee?: SenderPaintModel | null;
};

export type MediaPlaceholder = {
  attachmentCount: number;
  mediaKind: 'none' | 'image' | 'video' | 'file' | 'mixed';
  aspectRatio: number | null;
  cachedThumbUri: string | null;
  firstAttachmentName: string | null;
};

export type PaintPreviewSegment = {
  text: string;
  kind: 'text' | 'link' | 'mention';
};

export type ChatPaintRowKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
export type ChatPaintRowType = 'message' | 'media' | 'ticket' | 'system';

export type ChatPaintRow = {
  version: 10;
  rowId: string;
  conversationId: string;
  channelId: string;
  rowType: ChatPaintRowType;
  rowKind: ChatPaintRowKind;
  createdAt: number;
  timeLabel: string;
  estimatedHeight: number;
  senderPaintModel: SenderPaintModel;
  plainPreviewText: string;
  previewSegments?: PaintPreviewSegment[];
  showAvatar: boolean;
  showSenderName: boolean;
  replyCount: number;
  replyPreviewUserIds?: string[];
  reactionSummaryCount: number;
  ticketPreview: TicketPreview | null;
  mediaPlaceholder: MediaPlaceholder | null;
  parentPreviewText: string | null;
  parentConversationId: string | null;
};

export type ConversationPaintCache = {
  version: 10;
  cachedAt: number;
  channelId: string;
  channelType?: ChannelScopeType;
  rows: ChatPaintRow[];
  rowSignatures?: Record<string, string>;
};
