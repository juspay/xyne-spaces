import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, type InitialMessageSummary } from '@xyne/shared';

import { getConversationKind } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationKind';

const CURRENT_USER = 'user-self';

function makeSummary(overrides: Partial<InitialMessageSummary> = {}): InitialMessageSummary {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    workspaceId: 'w1',
    senderId: 'user-other',
    content: 'hello',
    msgType: MessageType.USER,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    showInChannel: true,
    visibleTo: null,
    createdAt: 1_700_000_000_000,
    metadata: null,
    nudgeCount: null,
    isSent: true,
    reactions_md: null,
    link_preview_md: null,
    childConversationId: null,
    ...overrides,
  };
}

test('getConversationKind: null summary is treated as SYSTEM', () => {
  assert.equal(getConversationKind(null, CURRENT_USER), 'SYSTEM');
});

test('getConversationKind: BOT message type maps to BOT', () => {
  assert.equal(getConversationKind(makeSummary({ msgType: MessageType.BOT }), CURRENT_USER), 'BOT');
});

test('getConversationKind: SYSTEM ticket-activity metadata stays SYSTEM', () => {
  const summary = makeSummary({
    msgType: MessageType.SYSTEM,
    metadata: JSON.stringify({ isTicketActivity: true, ticketId: 't1' }),
  });
  assert.equal(getConversationKind(summary, CURRENT_USER), 'SYSTEM');
});

test('getConversationKind: SYSTEM with a ticketId (not an activity) maps to TICKET', () => {
  const summary = makeSummary({
    msgType: MessageType.SYSTEM,
    metadata: JSON.stringify({ ticketId: 't1' }),
  });
  assert.equal(getConversationKind(summary, CURRENT_USER), 'TICKET');
});

test('getConversationKind: SYSTEM with no metadata maps to SYSTEM', () => {
  assert.equal(
    getConversationKind(makeSummary({ msgType: MessageType.SYSTEM, metadata: null }), CURRENT_USER),
    'SYSTEM',
  );
});

test('getConversationKind: malformed SYSTEM metadata is handled safely as SYSTEM', () => {
  const summary = makeSummary({ msgType: MessageType.SYSTEM, metadata: '{not valid json' });
  assert.equal(getConversationKind(summary, CURRENT_USER), 'SYSTEM');
});

test('getConversationKind: user message from the current user maps to CURRENT_USER', () => {
  const summary = makeSummary({ msgType: MessageType.USER, senderId: CURRENT_USER });
  assert.equal(getConversationKind(summary, CURRENT_USER), 'CURRENT_USER');
});

test('getConversationKind: user message from someone else maps to OTHER_USER', () => {
  const summary = makeSummary({ msgType: MessageType.USER, senderId: 'user-other' });
  assert.equal(getConversationKind(summary, CURRENT_USER), 'OTHER_USER');
});

test('getConversationKind: user message with an undefined current user maps to OTHER_USER', () => {
  const summary = makeSummary({ msgType: MessageType.USER, senderId: 'user-other' });
  assert.equal(getConversationKind(summary, undefined), 'OTHER_USER');
});
