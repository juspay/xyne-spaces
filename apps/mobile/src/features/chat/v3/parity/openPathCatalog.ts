import type { EntryPoint } from '../intent/entryPoint';
import type { LandingTarget } from '../machine/openState';

export type OpenPathCase = {
  id: string;
  params: Record<string, unknown>;
  expectedEntry: EntryPoint;
  expectedLandingKind: LandingTarget['kind'];
  expectedConversationId?: string;
  expectedColdStart?: boolean;
};

/**
 * Every way into a chat. Hint-only `classifyOpen` landing.
 * Resolve still records a frozen unread divider hint; landing is always tail
 * unless the open names a message.
 *
 * Open the chat:  tap / share / restore
 * Open a message: notification / activity / deeplink / search / forward / call
 */
export const OPEN_PATH_CATALOG: readonly OpenPathCase[] = [
  // --- Open the chat: read ---
  {
    id: 'tap-tail',
    params: { channelId: 'channel-1', source: 'tap' },
    expectedEntry: 'tap',
    expectedLandingKind: 'tail',
  },
  {
    id: 'tap-thread',
    params: { channelId: 'channel-1', threadId: 'thread-1', from: 'channel_thread' },
    expectedEntry: 'tap',
    expectedLandingKind: 'tail',
  },
  {
    id: 'tap-ticket-thread',
    params: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      ticketId: 'ticket-1',
      source: 'tap',
    },
    expectedEntry: 'tap',
    expectedLandingKind: 'tail',
  },
  {
    id: 'share-tail',
    params: { channelId: 'channel-1', source: 'share' },
    expectedEntry: 'share',
    expectedLandingKind: 'tail',
  },
  {
    id: 'restore-tail',
    params: { channelId: 'channel-1', source: 'restore' },
    expectedEntry: 'restore',
    expectedLandingKind: 'tail',
    expectedColdStart: true,
  },

  // --- Open the chat: unread (frozen at tap; stale drops later in resolve) ---
  {
    id: 'tap-unread',
    params: {
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadCount: '4',
      unreadLastViewedAt: '1700000000000',
      unreadLastViewedConversationId: 'conversation-9',
    },
    expectedEntry: 'tap',
    expectedLandingKind: 'tail',
  },
  {
    id: 'tap-unread-without-conversation-id',
    params: {
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadCount: '2',
      unreadLastViewedAt: '1700000000000',
    },
    expectedEntry: 'tap',
    expectedLandingKind: 'tail',
  },

  // --- Open a message: notification ---
  {
    id: 'notification-channel',
    params: {
      channelId: 'channel-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      source: 'notification',
    },
    expectedEntry: 'notification',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'notification-thread',
    params: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      origin: 'conversation-2',
      messageId: 'message-2',
      createdAt: '456',
      source: 'notification',
    },
    expectedEntry: 'notification',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-2',
  },
  {
    id: 'notification-ticket-thread',
    params: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      ticketId: 'ticket-1',
      messageId: 'reply-1',
      source: 'notification',
    },
    expectedEntry: 'notification',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'thread-1',
  },

  // --- Open a message: in-app and other-app links ---
  {
    id: 'deeplink-anchor',
    params: {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      createdAt: '123',
      source: 'deeplink',
    },
    expectedEntry: 'deeplink',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'deeplink-from-other-app',
    params: {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
    },
    expectedEntry: 'deeplink',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'deeplink-channel-only',
    params: { channelId: 'channel-1' },
    expectedEntry: 'deeplink',
    expectedLandingKind: 'tail',
  },
  {
    id: 'deeplink-thread-without-origin',
    params: {
      channelId: 'channel-1',
      threadId: 'conversation-1',
      messageId: 'reply-1',
      createdAt: '123',
      source: 'deeplink',
    },
    expectedEntry: 'deeplink',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },

  // --- Open a message: activity ---
  {
    id: 'activity-complete-message',
    params: {
      channelId: 'channel-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: '123',
      surface: 'dms',
      source: 'activity',
    },
    expectedEntry: 'activity',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'activity-navigateToMessage-bag',
    params: {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      createdAt: '123',
      source: 'activity',
      from: 'activity',
      landing: 'exact',
    },
    expectedEntry: 'activity',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'activity-thread-without-origin',
    params: {
      channelId: 'channel-1',
      threadId: 'conversation-1',
      messageId: 'reply-1',
      source: 'activity',
    },
    expectedEntry: 'activity',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },

  // --- Open a message: search / forward / call ---
  {
    id: 'search-anchor',
    params: {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      createdAt: '123',
      source: 'search',
    },
    expectedEntry: 'search',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'forward-anchor',
    params: {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      source: 'forward',
    },
    expectedEntry: 'forward',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'conversation-1',
  },
  {
    id: 'call-channel',
    params: { channelId: 'channel-1', source: 'call' },
    expectedEntry: 'call',
    expectedLandingKind: 'tail',
  },
  {
    id: 'call-thread',
    params: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'message-1',
      source: 'call',
    },
    expectedEntry: 'call',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'thread-1',
  },

  // --- Open a message: show-in-channel parent preview (still a tap) ---
  {
    id: 'tap-show-in-channel-parent',
    params: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'parent-1',
      from: 'channel_thread',
    },
    expectedEntry: 'tap',
    expectedLandingKind: 'anchor',
    expectedConversationId: 'thread-1',
  },
];
