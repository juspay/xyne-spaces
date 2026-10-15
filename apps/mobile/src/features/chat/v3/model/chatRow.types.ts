/**
 * v3 row model. Canonical sub-models only — no @deprecated alias fields.
 * `flowParts` is a structural type so the pure model does not import the Flow
 * JSON parser.
 */

export type FlowJsonPart = { type: 'flow'; definition: unknown } | { type: 'html'; html: string };

export type ChatRowKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
export type ChatRowType = 'message' | 'media' | 'ticket' | 'system';
export type MessageTypeName = 'USER' | 'BOT' | 'SYSTEM' | 'FORWARDED';

export type SenderModel = {
  senderId: string;
  displayName: string;
  avatarUri: string | null;
  colorIndex: number;
};

export type PreviewSegment =
  | { text: string; kind: 'text' }
  | { text: string; kind: 'link'; url?: string }
  | { text: string; kind: 'mention'; url: string; mentionsYou?: boolean }
  | { text: string; kind: 'emoji'; emojiId: string; name: string; uri?: string };

export type CollapseModel = {
  isCollapsible: boolean;
  collapsedLines: number;
};

export type ChatBody = {
  markdown: string;
  plainText: string;
  segments: PreviewSegment[];
  customEmojiIds: string[];
  collapse: CollapseModel;
  collapsedPreviewText: string;
  isVisibleToCurrentUser: boolean;
  inlineMarkdown: string | undefined;
  /** Parsed Flow-JSON/html parts. Present only for Flow messages. */
  flowParts: readonly FlowJsonPart[];
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
  md: string;
};

export type ReplyPreview = {
  count: number;
  latestReplierIds: string[];
  canOpenThread: boolean;
};

export type MediaItem = {
  id: string;
  mimetype: string;
  originalFilename?: string;
  size?: number;
  durationSeconds?: number;
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
  items: readonly MediaItem[];
};

export type TicketPreview = {
  ticketId: string;
  title: string;
  description: string | null;
  statusLabel: string;
  priority: string | null;
  assigneeId?: string | null;
};

export type CallPreview = {
  callId: string | null;
  title: string;
  operation: string | null;
  durationMs: number | null;
};

export type NonParticipantPreview = {
  userIds: readonly string[];
  channelId: string;
  canAddMembers: boolean;
};

export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  description: string | null;
  siteName: string | null;
  image: string | null;
  favicon: string | null;
  needsMetadataFetch: boolean;
  source: 'stored' | 'extracted' | 'metadata';
  status: 'ready' | 'needsMetadata' | 'failed';
  reservedHeightPx: number;
};

export type ParentPreview = {
  conversationId: string;
  messageId: string;
  text: string;
  segments: PreviewSegment[];
  customEmojiIds: string[];
  reservedHeightPx: number;
};

export type ForwardedPreview = {
  fromName: string;
  originalSenderId: string | null;
  colorIndex: number;
  originalCreatedAt: number | null;
  originalChannelId: string | null;
  originalConversationId: string | null;
  originalMessageId: string | null;
  originalHtml: string;
  originalMarkdown: string;
  reservedHeightPx: number;
};

export type EmojiSlot = {
  index: number;
  reservedWidthPx: number;
};

export type MessageRowModel = {
  conversationId: string;
  messageId: string | null;
  channelId: string;
  createdAt: number;
  rowType: ChatRowType;
  rowKind: ChatRowKind;
  messageType: MessageTypeName;
  sender: SenderModel;
  viewerId: string;
  /** Original composer HTML used by edit, copy, and forward actions. */
  storedHtml: string;
  body: ChatBody;
  reactionPreview: ReactionPreview | null;
  replyPreview: ReplyPreview | null;
  mediaPreview: MediaPreview | null;
  ticketPreview: TicketPreview | null;
  callPreview: CallPreview | null;
  nonParticipantPreview: NonParticipantPreview | null;
  linkPreview: LinkPreview | null;
  parentPreview: ParentPreview | null;
  forwarded: ForwardedPreview | null;
  emojiSlots: readonly EmojiSlot[];
  showAvatar: boolean;
  showSenderName: boolean;
  /** DM surfaces hide all identity chrome and reserve no avatar column (v2 parity). */
  isDm: boolean;
  isDeleted: boolean;
  isCall: boolean;
  isTicketCreation: boolean;
  isShowInChannel: boolean;
  isTicketActivity: boolean;
  isPinned: boolean;
  isBookmarked: boolean;
  isEdited: boolean;
  isFlowJson: boolean;
  timeLabel: string;
  contentSignature: string;
  /** User tapped Show more. List-owned; applied after `buildRows`. */
  isExpanded: boolean;
  /** Jump-to-message landing. List-owned; applied after `buildRows`. */
  isHighlighted: boolean;
  /** Tail-append entrance. List-owned; applied after `buildRows`. */
  isEntering: boolean;
  /** Pending reminder copy from the bookmark store. List-owned. */
  reminderLabel: string | null;
  /** Thread surfaces only: reply count painted under the parent row. */
  threadReplyCount: number;
};

export type ChatRow =
  | { type: 'date'; id: string; date: number }
  | { type: 'unread-divider'; id: string }
  | { type: 'message'; id: string; model: MessageRowModel };

export type ChatMessageRow = Extract<ChatRow, { type: 'message' }>;

/** Fields that must never appear on a row model (v2 v13 aliases). */
export const FORBIDDEN_ALIAS_FIELDS = [
  'plainPreviewText',
  'collapsedPreviewText',
  'inlineMarkdown',
  'previewSegments',
  'replyCount',
  'replyPreviewUserIds',
  'reactionSummaryCount',
  'replyAvatarSlots',
  'collapse',
] as const;
