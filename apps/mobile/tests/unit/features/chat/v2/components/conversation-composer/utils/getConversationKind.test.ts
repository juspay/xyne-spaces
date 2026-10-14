import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MessageType, type InitialMessageSummary } from '@xyne/shared';

import { getConversationKind } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationKind';

const makeSummary = (overrides: Partial<InitialMessageSummary>): InitialMessageSummary => ({
  messageId: 'm1',
  conversationId: 'c1',
  senderId: 'sender-1',
  content: 'hi',
  msgType: MessageType.USER,
  hasAttachment: false,
  edited: false,
  isDeleted: false,
  showInChannel: true,
  createdAt: 0,
  metadata: null,
  isSent: true,
  ...overrides,
});

describe('getConversationKind', () => {
  it('treats a missing summary as SYSTEM', () => {
    assert.equal(getConversationKind(null, 'me'), 'SYSTEM');
  });

  it('classifies bot messages', () => {
    assert.equal(getConversationKind(makeSummary({ msgType: MessageType.BOT }), 'me'), 'BOT');
  });

  it('routes ticket-activity system messages to SYSTEM', () => {
    const summary = makeSummary({
      msgType: MessageType.SYSTEM,
      metadata: JSON.stringify({ isTicketActivity: true, ticketId: 't1' }),
    });
    assert.equal(getConversationKind(summary, 'me'), 'SYSTEM');
  });

  it('routes system messages carrying a ticketId to TICKET', () => {
    const summary = makeSummary({
      msgType: MessageType.SYSTEM,
      metadata: JSON.stringify({ ticketId: 't1' }),
    });
    assert.equal(getConversationKind(summary, 'me'), 'TICKET');
  });

  it('treats plain and unparseable system metadata as SYSTEM', () => {
    assert.equal(
      getConversationKind(makeSummary({ msgType: MessageType.SYSTEM, metadata: null }), 'me'),
      'SYSTEM',
    );
    assert.equal(
      getConversationKind(makeSummary({ msgType: MessageType.SYSTEM, metadata: 'not-json' }), 'me'),
      'SYSTEM',
    );
  });

  it('distinguishes the current user from other users', () => {
    assert.equal(getConversationKind(makeSummary({ senderId: 'u1' }), 'u1'), 'CURRENT_USER');
    assert.equal(getConversationKind(makeSummary({ senderId: 'u1' }), 'u2'), 'OTHER_USER');
    assert.equal(getConversationKind(makeSummary({ senderId: 'u1' }), undefined), 'OTHER_USER');
  });
});
