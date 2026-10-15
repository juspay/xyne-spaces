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
  attachments: {
    id: string;
    mimetype: string;
    originalFilename?: string | undefined;
    size?: number | undefined;
  }[];
  mediaKind: 'none' | 'image' | 'video' | 'file' | 'mixed';
  previewAttachmentId: string | null;
  previewAttachmentKind: 'image' | 'video' | null;
  aspectRatio: number | null;
  cachedThumbUri: string | null;
  durationSeconds: number | null;
  firstAttachmentName: string | null;
};

export type ChatPaintEmojiSlot = {
  index: number;
  reservedWidthPx: number;
};

export type ChatPaintMediaGeometry = {
  aspectRatio: number;
  reservedHeightPx: number;
  thumbUri?: string | undefined;
};

export type ChatPaintParentPreview = {
  messageId: string;
  reservedHeightPx: number;
  text: string;
  segments: PaintPreviewSegment[];
  customEmojiIds: string[];
};

export type LinkPreviewSource = 'stored' | 'extracted' | 'metadata';
export type LinkPreviewStatus = 'ready' | 'needsMetadata' | 'failed';

export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  description: string | null;
  siteName?: string | undefined;
  image?: string | undefined;
  favicon?: string | undefined;
  needsMetadataFetch?: boolean | undefined;
  source?: LinkPreviewSource | undefined;
  status?: LinkPreviewStatus | undefined;
};

export type ChatPaintCollapseModel = {
  isCollapsible: boolean;
  collapsedLines: number;
};

export type RecordingPreview = {
  callId: string;
  durationMs: number;
  title: string;
};

export type PaintPreviewSegment =
  | {
      text: string;
      kind: 'text';
    }
  | {
      text: string;
      kind: 'link';
      url?: string | undefined;
    }
  | {
      text: string;
      kind: 'mention';
      mentionsYou?: boolean;
    }
  | {
      text: string;
      kind: 'emoji';
      emojiId: string;
      name: string;
      uri?: string;
    };

// ---------------------------------------------------------------------------
// v14 canonical render-model types
// ---------------------------------------------------------------------------

export type ChatPaintBody = {
  /** Normalized markdown already converted from initial_message_md via htmlToMD. */
  markdown: string;
  /** Plain fallback text (HTML-stripped). */
  plainText: string;
  /** Text/link/mention/custom-emoji/code-aware render runs. */
  segments: PaintPreviewSegment[];
  /** Unique custom emoji IDs needed by the row (for prefetch + hydration). */
  customEmojiIds: string[];
  /** Collapse model for long messages. */
  collapse: ChatPaintCollapseModel;
  /** Collapsed preview text (pre-computed). */
  collapsedPreviewText: string;
  /** True when summary.visibleTo does not exclude the current user. */
  isVisibleToCurrentUser: boolean;
  /** Inline-only markdown safe for the RichInlineText renderer (no block constructs / custom emoji). */
  inlineMarkdown?: string | undefined;
};

export type ReactionPreviewGroup = {
  emojiName: string;
  count: number;
  earliestTimestamp: number;
};

export type ReactionPreviewItem = {
  createdAt: number;
  emojiName: string;
  messageId: string;
  reactionId: string;
  userId: string;
};

export type ReactionPreview = {
  messageId: string;
  totalCount: number;
  groups: ReactionPreviewGroup[];
  reactions: ReactionPreviewItem[];
};

export type ReplyPreview = {
  count: number;
  latestReplierIds: string[];
  canOpenThread: boolean;
};

export type MediaPreview = {
  attachmentId: string | null;
  kind: 'image' | 'video' | 'file' | 'mixed';
  mime: string | null;
  filename: string | null;
  reservedHeightPx: number;
  aspectRatio: number;
  cachedThumbUri: string | null;
  durationSeconds: number | null;
  attachmentCount: number;
  previewAttachmentKind: 'image' | 'video' | null;
};

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

export type ChatPaintRowKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
export type ChatPaintRowType = 'message' | 'media' | 'ticket' | 'system';

export type ChatPaintRow = {
  rowId: string;
  conversationId: string;
  messageId: string | null;
  channelId: string;
  rowType: ChatPaintRowType;
  rowKind: ChatPaintRowKind;
  createdAt: number;
  timeLabel: string;
  estimatedHeight: number;
  senderPaintModel: SenderPaintModel;
  // v14 canonical body — single source of truth for text rendering
  body: ChatPaintBody;
  // v14 reaction preview — grouped summary for pill rendering
  reactionPreview: ReactionPreview | null;
  // v14 reply preview — count + latest repliers for tray
  replyPreview: ReplyPreview | null;
  // v14 media preview — stable attachment geometry
  mediaPreview: MediaPreview | null;
  currentUserId?: string | undefined;
  showAvatar: boolean;
  showSenderName: boolean;
  isTicketActivity?: boolean;
  isDeleted?: boolean;
  ticketPreview: TicketPreview | null;
  linkPreview: LinkPreview | null;
  recordingPreview: RecordingPreview | null;
  mediaPlaceholder: MediaPlaceholder | null;
  /** Every attachment on this message is soft-deleted; show "This file was deleted." under body. */
  allAttachmentsDeleted: boolean;
  parentPreviewText: string | null;
  parentConversationId: string | null;
  emojiSlots: readonly ChatPaintEmojiSlot[];
  media?: ChatPaintMediaGeometry | undefined;
  parentPreview?: ChatPaintParentPreview | undefined;
  contentSignature: string;

  // --- v13 backward-compat aliases (kept so old render code still compiles
  //     during the transition; populated by the builder from body/collapse) ---
  /** @deprecated Use body.markdown */ plainPreviewText: string;
  /** @deprecated Use body.collapsedPreviewText */ collapsedPreviewText?: string | undefined;
  /** @deprecated Use body.inlineMarkdown */ inlineMarkdown?: string | undefined;
  /** @deprecated Use body.segments */ previewSegments?: PaintPreviewSegment[];
  /** @deprecated Use replyPreview.count */ replyCount: number;
  /** @deprecated Use replyPreview.latestReplierIds */ replyPreviewUserIds?: string[];
  /** @deprecated Use reactionPreview.totalCount */ reactionSummaryCount: number;
  /** @deprecated Use mediaPreview + media */ replyAvatarSlots: number;
  /** @deprecated Use body.collapse */ collapse: ChatPaintCollapseModel;
};

export type ConversationPaintCache = {
  cachedAt: number;
  channelId: string;
  channelType?: ChannelScopeType;
  rows: ChatPaintRow[];
  rowSignatures?: Record<string, string>;
};
