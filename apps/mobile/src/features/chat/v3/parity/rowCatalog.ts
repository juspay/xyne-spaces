import type { ConversationInput } from '../model/conversationInput';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const base = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch-1',
  createdAt: DAY,
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '',
  markdown: 'hello',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: null,
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

export type ChannelKind = 'dm' | 'channel';

export type RowCatalogEntry = {
  id: string;
  channelKind: ChannelKind;
  currentUserId: string;
  input: ConversationInput;
  expected: {
    rowKind: 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
    rowType: 'message' | 'media' | 'ticket' | 'system';
    isCall?: boolean;
    hasNonParticipantPreview?: boolean;
    isDeleted?: boolean;
    isFlowJson?: boolean;
    hasReactions?: boolean;
    hasReplies?: boolean;
    hasParentPreview?: boolean;
    hasLinkPreview?: boolean;
    isPinned?: boolean;
    isBookmarked?: boolean;
    isEdited?: boolean;
  };
};

const ticket = {
  ticketId: 't',
  title: 'T',
  description: null,
  statusLabel: 'open',
  priority: null,
} as const;

/** Every paint shape P3 needs, as `ConversationInput`. Not a pixel gallery. */
export const ROW_CATALOG: readonly RowCatalogEntry[] = [
  {
    id: 'text-other-channel',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base(),
    expected: { rowKind: 'OTHER_USER', rowType: 'message' },
  },
  {
    id: 'text-own-channel',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ senderId: 'me', senderDisplayName: 'Me' }),
    expected: { rowKind: 'CURRENT_USER', rowType: 'message' },
  },
  {
    id: 'text-other-dm',
    channelKind: 'dm',
    currentUserId: 'me',
    input: base(),
    expected: { rowKind: 'OTHER_USER', rowType: 'message' },
  },
  {
    id: 'text-own-dm',
    channelKind: 'dm',
    currentUserId: 'me',
    input: base({ senderId: 'me', senderDisplayName: 'Me' }),
    expected: { rowKind: 'CURRENT_USER', rowType: 'message' },
  },
  {
    id: 'long-collapsed',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({
      markdown: Array.from({ length: 24 }, (_, i) => `${i}. line`).join('\n'),
    }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message' },
  },
  {
    id: 'emoji-only',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ markdown: 'xemoji:e1:wave:emojix' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message' },
  },
  {
    id: 'media-image',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ attachments: [{ id: 'a', mimetype: 'image/png', width: 4, height: 3 }] }),
    expected: { rowKind: 'OTHER_USER', rowType: 'media' },
  },
  {
    id: 'media-video',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ attachments: [{ id: 'a', mimetype: 'video/mp4' }] }),
    expected: { rowKind: 'OTHER_USER', rowType: 'media' },
  },
  {
    id: 'media-file',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ attachments: [{ id: 'a', mimetype: 'application/pdf' }] }),
    expected: { rowKind: 'OTHER_USER', rowType: 'media' },
  },
  {
    id: 'media-mixed',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({
      attachments: [
        { id: 'a', mimetype: 'image/png' },
        { id: 'b', mimetype: 'application/zip' },
      ],
    }),
    expected: { rowKind: 'OTHER_USER', rowType: 'media' },
  },
  {
    id: 'ticket',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({
      messageType: 'SYSTEM',
      metadata: { ticketId: 't' },
      ticketPreview: ticket,
    }),
    expected: { rowKind: 'TICKET', rowType: 'ticket' },
  },
  {
    id: 'ticket-activity',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ messageType: 'SYSTEM', metadata: { isTicketActivity: true } }),
    expected: { rowKind: 'SYSTEM', rowType: 'system' },
  },
  {
    id: 'flow-json',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ isFlowJson: true, markdown: '{"flow":true}' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', isFlowJson: true },
  },
  {
    id: 'forwarded',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ forwardedFromName: 'Lin', messageType: 'FORWARDED' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message' },
  },
  {
    id: 'system',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ messageType: 'SYSTEM', markdown: 'Ada joined' }),
    expected: { rowKind: 'SYSTEM', rowType: 'system' },
  },
  {
    id: 'call-message',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({
      messageType: 'SYSTEM',
      metadata: {
        isCallMessage: true,
        callId: 'call-1',
        callTitle: 'Design review',
        durationMs: 90_000,
      },
    }),
    expected: { rowKind: 'SYSTEM', rowType: 'system', isCall: true },
  },
  {
    id: 'non-participant-system',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({
      messageType: 'SYSTEM',
      metadata: {
        messageSubtype: 'user_not_in_channel',
        mentionedUsers: [{ userId: 'u3' }],
      },
      markdown: 'Please add [**@Ada**](xyne://user/u3)',
    }),
    expected: { rowKind: 'SYSTEM', rowType: 'system', hasNonParticipantPreview: true },
  },
  {
    id: 'bot',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ messageType: 'BOT', senderId: 'bot', senderDisplayName: 'Bot' }),
    expected: { rowKind: 'BOT', rowType: 'message' },
  },
  {
    id: 'deleted',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ isDeleted: true }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', isDeleted: true },
  },
  {
    id: 'with-reactions',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ reactionsMd: 'wave' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', hasReactions: true },
  },
  {
    id: 'with-replies',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ replyCount: 2, latestReplierIds: ['a'] }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', hasReplies: true },
  },
  {
    id: 'with-parent-preview',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ parentConversationId: 'p', parentMarkdown: 'orig' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', hasParentPreview: true },
  },
  {
    id: 'link-preview',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ linkUrl: 'https://example.com', linkTitle: 'Ex' }),
    expected: { rowKind: 'OTHER_USER', rowType: 'message', hasLinkPreview: true },
  },
  {
    id: 'pinned-bookmarked-edited',
    channelKind: 'channel',
    currentUserId: 'me',
    input: base({ isPinned: true, isBookmarked: true, isEdited: true }),
    expected: {
      rowKind: 'OTHER_USER',
      rowType: 'message',
      isPinned: true,
      isBookmarked: true,
      isEdited: true,
    },
  },
];

export const ROW_CATALOG_IDS: readonly string[] = ROW_CATALOG.map(entry => entry.id);
