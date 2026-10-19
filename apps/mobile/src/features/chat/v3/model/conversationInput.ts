import type { ChatRowKind, MessageTypeName, TicketPreview } from './chatRow.types';

export type ChannelKind = 'dm' | 'channel';

const DIRECT_MESSAGE_SCOPE = 'DM';

/** v2: only 1:1 DMs hide identity. Group DMs keep avatars and sender names. */
export const channelKindOf = (scopeType: string | undefined): ChannelKind =>
  scopeType === DIRECT_MESSAGE_SCOPE ? 'dm' : 'channel';

export type AttachmentInput = {
  id: string;
  mimetype: string;
  originalFilename?: string;
  size?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  thumbUri?: string | null;
};

export type ForwardedSource = {
  originalSenderId: string | null;
  originalCreatedAt: number | null;
  originalChannelId: string | null;
  originalConversationId: string | null;
  originalMessageId: string | null;
  originalHtml: string;
};

export type ConversationInput = {
  conversationId: string;
  channelId: string;
  createdAt: number;
  messageId: string | null;
  senderId: string;
  senderDisplayName: string;
  senderAvatarUri: string | null;
  messageType: MessageTypeName;
  /** HTML used for the visible body; forwarded wrappers contain the optional comment only. */
  html: string;
  /** Original persisted HTML used by copy, edit, and forward actions. */
  storedHtml?: string;
  markdown: string;
  isDeleted: boolean;
  showInChannel: boolean;
  isVisibleToCurrentUser: boolean;
  metadata: Record<string, unknown> | null;
  attachments: readonly AttachmentInput[];
  ticketPreview: TicketPreview | null;
  parentConversationId: string | null;
  parentMessageId: string | null;
  parentMarkdown: string | null;
  replyCount: number;
  latestReplierIds: readonly string[];
  reactionsMd: string | null;
  linkUrl: string | null;
  linkTitle: string | null;
  linkDescription: string | null;
  linkSiteName?: string | null;
  linkImage?: string | null;
  linkFavicon?: string | null;
  linkNeedsMetadataFetch?: boolean;
  forwardedFromName: string | null;
  forwardedSource: ForwardedSource | null;
  isPinned: boolean;
  isBookmarked: boolean;
  isEdited: boolean;
  isFlowJson: boolean;
};

export type BuildRowsContext = {
  channelId: string;
  channelKind: ChannelKind;
  currentUserId: string;
  unreadBoundaryAt?: number;
  unreadBoundaryConversationId?: string;
  previousRows?: readonly import('./chatRow.types').ChatRow[];
};

export const rowKindFor = (
  messageType: MessageTypeName,
  senderId: string,
  currentUserId: string,
  metadata: Record<string, unknown> | null,
  ticketPreview: TicketPreview | null,
): ChatRowKind => {
  if (messageType === 'BOT') return 'BOT';
  if (messageType === 'SYSTEM') {
    if (metadata?.['isTicketActivity'] === true) return 'SYSTEM';
    if (ticketPreview || metadata?.['ticketId'] !== undefined) return 'TICKET';
    return 'SYSTEM';
  }
  if (senderId && currentUserId && senderId === currentUserId) return 'CURRENT_USER';
  return 'OTHER_USER';
};
