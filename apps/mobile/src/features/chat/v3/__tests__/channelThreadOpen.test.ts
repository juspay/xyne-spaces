import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { channelThreadOpen } from '../screens/channelThreadOpen';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
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
  replyCount: 2,
  latestReplierIds: ['a'],
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

const ctx = { channelId: 'ch', channelKind: 'channel' as const, currentUserId: 'me' };

const modelOf = (over: Partial<ConversationInput> = {}) => {
  const row = buildRows([input(over)], ctx).find(item => item.type === 'message');
  assert.ok(row && row.type === 'message');
  return row.model;
};

describe('channelThreadOpen', (): void => {
  it('opens a replies tap as a thread, not a message jump', (): void => {
    const open = channelThreadOpen(modelOf(), 'ch', 1);
    assert.equal(open.pathname, '/chat/[channelId]/[threadId]');
    assert.equal(open.params.threadId, 'c1');
    assert.equal(open.params.from, 'channel_thread');
    assert.equal('messageId' in open.params && open.params.messageId, false);
  });

  it('sends ticket conversations to Ticket Details without a jump target', (): void => {
    const open = channelThreadOpen(
      modelOf({
        messageType: 'SYSTEM',
        metadata: { ticketId: 't-1' },
        ticketPreview: {
          ticketId: 't-1',
          title: 'Release',
          description: null,
          statusLabel: 'Created',
          priority: null,
        },
      }),
      'ch',
      1,
    );
    assert.equal(open.pathname, '/ticket/[ticketId]');
    if (open.pathname !== '/ticket/[ticketId]') return;
    assert.equal(open.params.ticketId, 't-1');
    assert.equal(open.params.selectedTab, 'thread');
    assert.equal('messageId' in open.params, false);
  });

  it('keeps a parent-preview tap as a jump into that thread', (): void => {
    const open = channelThreadOpen(
      modelOf({
        conversationId: 'reply-1',
        parentConversationId: 'parent-thread',
        parentMessageId: 'parent-msg',
        parentMarkdown: 'orig',
      }),
      'ch',
      1,
    );
    assert.equal(open.pathname, '/chat/[channelId]/[threadId]');
    if (open.pathname !== '/chat/[channelId]/[threadId]') return;
    assert.equal(open.params.threadId, 'parent-thread');
    assert.equal(open.params.messageId, 'parent-msg');
  });
});
