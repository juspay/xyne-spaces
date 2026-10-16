import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyRowPresentation } from '../model/applyRowPresentation';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { rowsAreEqual } from '../model/rowEquals';
import type { ChatRow } from '../model/chatRow.types';

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

const message = (rows: readonly ChatRow[], id: string): Extract<ChatRow, { type: 'message' }> => {
  const row = rows.find(item => item.type === 'message' && item.model.conversationId === id);
  assert.ok(row && row.type === 'message');
  return row;
};

describe('applyRowPresentation', (): void => {
  it('keeps row identity when nothing is expanded or highlighted', (): void => {
    const rows = buildRows(
      [input({ conversationId: 'a' }), input({ conversationId: 'b', createdAt: DAY + 1 })],
      ctx,
    );
    const painted = applyRowPresentation(rows, {
      expandedIds: new Set(),
      highlightedConversationId: null,
    });
    assert.equal(painted, rows);
    assert.equal(message(painted, 'a'), message(rows, 'a'));
  });

  it('clones only the expanded message and invalidates itemsAreEqual', (): void => {
    const rows = buildRows(
      [input({ conversationId: 'a' }), input({ conversationId: 'b', createdAt: DAY + 1 })],
      ctx,
    );
    const painted = applyRowPresentation(rows, {
      expandedIds: new Set(['b']),
      highlightedConversationId: null,
    });
    assert.notEqual(painted, rows);
    assert.equal(message(painted, 'a'), message(rows, 'a'));
    assert.notEqual(message(painted, 'b'), message(rows, 'b'));
    assert.equal(message(painted, 'b').model.isExpanded, true);
    assert.equal(message(painted, 'a').model.isExpanded, false);
    assert.equal(rowsAreEqual(message(rows, 'b'), message(painted, 'b')), false);
    assert.equal(
      message(rows, 'b').model.contentSignature,
      message(painted, 'b').model.contentSignature,
    );
  });

  it('marks the jump-to-message row highlighted without cloning others', (): void => {
    const rows = buildRows(
      [input({ conversationId: 'a' }), input({ conversationId: 'b', createdAt: DAY + 1 })],
      ctx,
    );
    const painted = applyRowPresentation(rows, {
      expandedIds: new Set(),
      highlightedConversationId: 'a',
    });
    assert.equal(message(painted, 'a').model.isHighlighted, true);
    assert.equal(message(painted, 'b'), message(rows, 'b'));
  });

  it('highlights a row whose messageId matches the jump id', (): void => {
    const rows = buildRows([input({ conversationId: 'c-origin', messageId: 'm-reply' })], ctx);
    const painted = applyRowPresentation(rows, {
      highlightedConversationId: 'm-reply',
    });
    assert.equal(message(painted, 'c-origin').model.isHighlighted, true);
  });

  it('clones only entering and reminder rows', (): void => {
    const rows = buildRows(
      [
        input({ conversationId: 'a', messageId: 'm-a' }),
        input({ conversationId: 'b', createdAt: DAY + 1, messageId: 'm-b' }),
      ],
      ctx,
    );
    const painted = applyRowPresentation(rows, {
      enteringIds: new Set(['b']),
      reminderByMessageId: new Map([['m-a', 'Reminder Set - Due in 5m']]),
    });
    assert.equal(message(painted, 'b').model.isEntering, true);
    assert.equal(message(painted, 'a').model.reminderLabel, 'Reminder Set - Due in 5m');
    assert.equal(message(painted, 'a').model.isEntering, false);
    assert.equal(rowsAreEqual(message(rows, 'a'), message(painted, 'a')), false);
  });
});
