import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

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

const ctx = {
  channelId: 'ch',
  channelKind: 'channel' as const,
  currentUserId: 'me',
};

describe('unread divider placement', (): void => {
  it('sits before the first other-user message after last viewed, not on an equal timestamp', (): void => {
    const rows = buildRows(
      [
        input({ conversationId: 'seen', createdAt: DAY }),
        input({ conversationId: 'same-ts', createdAt: DAY + 500, markdown: 'edge' }),
        input({ conversationId: 'new', createdAt: DAY + 1000, markdown: 'later' }),
      ],
      { ...ctx, unreadBoundaryAt: DAY + 500 },
    );
    const types = rows
      .filter(row => row.type !== 'date')
      .map(row => (row.type === 'message' ? row.id : row.type));
    assert.deepEqual(types, ['seen', 'same-ts', 'unread-divider', 'new']);
  });

  it('skips own messages and join pills when finding the first unread', (): void => {
    const rows = buildRows(
      [
        input({ conversationId: 'seen', createdAt: DAY }),
        input({
          conversationId: 'mine',
          createdAt: DAY + 800,
          senderId: 'me',
          markdown: 'own',
        }),
        input({
          conversationId: 'join',
          createdAt: DAY + 900,
          messageType: 'SYSTEM',
          markdown: 'joined',
        }),
        input({ conversationId: 'new', createdAt: DAY + 1000, markdown: 'later' }),
      ],
      { ...ctx, unreadBoundaryAt: DAY + 500 },
    );
    const dividerAt = rows.findIndex(row => row.type === 'unread-divider');
    assert.ok(dividerAt >= 0);
    const rowAfterDivider = rows[dividerAt + 1];
    assert.equal(rowAfterDivider?.type, 'message');
    if (rowAfterDivider?.type === 'message') {
      assert.equal(rowAfterDivider.id, 'new');
    }
  });

  it('prefers the last-viewed conversation cursor over a looser timestamp', (): void => {
    const rows = buildRows(
      [
        input({ conversationId: 'older', createdAt: DAY }),
        input({ conversationId: 'cursor', createdAt: DAY + 400 }),
        input({ conversationId: 'skipped-own', createdAt: DAY + 600, senderId: 'me' }),
        input({ conversationId: 'first-after-cursor', createdAt: DAY + 800 }),
      ],
      {
        ...ctx,
        unreadBoundaryAt: DAY + 100,
        unreadBoundaryConversationId: 'cursor',
      },
    );
    const dividerAt = rows.findIndex(row => row.type === 'unread-divider');
    assert.ok(dividerAt >= 0);
    const rowAfterDivider = rows[dividerAt + 1];
    if (rowAfterDivider?.type === 'message') {
      assert.equal(rowAfterDivider.id, 'first-after-cursor');
    }
  });

  it('does not invent a divider without a positive last-viewed time', (): void => {
    const rows = buildRows(
      [input({ conversationId: 'a' }), input({ conversationId: 'b', createdAt: DAY + 1 })],
      { ...ctx, unreadBoundaryAt: 0 },
    );
    assert.equal(
      rows.some(row => row.type === 'unread-divider'),
      false,
    );
  });
});
