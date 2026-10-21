import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MessageType, type InitialMessageSummary } from '@xyne/shared';

import { getConversationKind } from '@/src/components/conversation-composer/utils/getConversationKind';

const summary = (over: Partial<InitialMessageSummary>): InitialMessageSummary =>
  ({
    messageId: 'm1',
    conversationId: 'c1',
    senderId: 'u1',
    content: 'hi',
    msgType: MessageType.USER,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    showInChannel: true,
    createdAt: 0,
    isSent: true,
    ...over,
  }) as InitialMessageSummary;

describe('getConversationKind', () => {
  it('returns SYSTEM when there is no summary', () => {
    assert.equal(getConversationKind(null, 'u1'), 'SYSTEM');
  });

  it('returns BOT for bot messages', () => {
    assert.equal(getConversationKind(summary({ msgType: MessageType.BOT }), 'u1'), 'BOT');
  });

  it('returns TICKET for a SYSTEM message flagged as ticket activity', () => {
    const s = summary({
      msgType: MessageType.SYSTEM,
      metadata: JSON.stringify({ isTicketActivity: true }),
    });
    assert.equal(getConversationKind(s, 'u1'), 'TICKET');
  });

  it('returns TICKET for a SYSTEM message carrying a ticketId', () => {
    const s = summary({
      msgType: MessageType.SYSTEM,
      metadata: JSON.stringify({ ticketId: 'T-9' }),
    });
    assert.equal(getConversationKind(s, 'u1'), 'TICKET');
  });

  it('returns SYSTEM for a plain SYSTEM message (no/invalid metadata)', () => {
    assert.equal(getConversationKind(summary({ msgType: MessageType.SYSTEM }), 'u1'), 'SYSTEM');
    const bad = summary({ msgType: MessageType.SYSTEM, metadata: 'not json' });
    assert.equal(getConversationKind(bad, 'u1'), 'SYSTEM');
  });

  it('returns CURRENT_USER when the sender is the viewer', () => {
    assert.equal(getConversationKind(summary({ senderId: 'me' }), 'me'), 'CURRENT_USER');
  });

  it('returns OTHER_USER when the sender differs from the viewer', () => {
    assert.equal(getConversationKind(summary({ senderId: 'them' }), 'me'), 'OTHER_USER');
    // No current user id → cannot be CURRENT_USER.
    assert.equal(getConversationKind(summary({ senderId: 'them' }), undefined), 'OTHER_USER');
  });
});
