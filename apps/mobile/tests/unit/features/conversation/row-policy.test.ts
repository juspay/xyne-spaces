import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import {
  isRestyledRow,
  isUnreadableMessage,
  usesClassicRow,
  type RowFacts,
} from '@/src/features/conversation/model/row-policy';

const plain: RowFacts = {
  hasConversation: true,
  rowKind: 'OTHER_USER',
  isTicketActivity: false,
  hasTicketPreview: false,
  hasSender: true,
  hasRecordingPreview: false,
  isFlowJson: false,
};

describe('usesClassicRow', () => {
  it('restyles ordinary messages', () => {
    assert.equal(usesClassicRow(plain), false);
    assert.equal(usesClassicRow({ ...plain, rowKind: 'CURRENT_USER' }), false);
    assert.equal(usesClassicRow({ ...plain, rowKind: 'BOT' }), false);
  });

  it('keeps the classic row for undrawn cards and system lines', () => {
    assert.equal(usesClassicRow({ ...plain, rowKind: 'SYSTEM' }), true);
    assert.equal(usesClassicRow({ ...plain, isTicketActivity: true }), true);
    assert.equal(usesClassicRow({ ...plain, hasRecordingPreview: true }), true);
    assert.equal(usesClassicRow({ ...plain, isFlowJson: true }), true);
  });

  it('draws a ticket card flat under its sender', () => {
    assert.equal(usesClassicRow({ ...plain, hasTicketPreview: true }), false);
    assert.equal(usesClassicRow({ ...plain, rowKind: 'TICKET', hasTicketPreview: true }), false);
  });

  it('keeps the classic ticket notice when it names no sender or carries no card', () => {
    assert.equal(
      usesClassicRow({ ...plain, rowKind: 'TICKET', hasTicketPreview: true, hasSender: false }),
      true,
    );
    assert.equal(usesClassicRow({ ...plain, rowKind: 'TICKET' }), true);
  });

  it('keeps the classic row until the conversation has hydrated', () => {
    assert.equal(usesClassicRow({ ...plain, hasConversation: false }), true);
  });
});

describe('isRestyledRow', () => {
  const paint = (overrides: Partial<ChatPaintRow> = {}): ChatPaintRow =>
    ({
      rowKind: 'OTHER_USER',
      senderPaintModel: { senderId: 'u1' },
      ticketPreview: null,
      recordingPreview: null,
      ...overrides,
    }) as ChatPaintRow;

  it('reads the same facts from the paint row', () => {
    assert.equal(isRestyledRow(paint()), true);
    assert.equal(isRestyledRow(paint({ rowKind: 'SYSTEM' })), false);
    assert.equal(isRestyledRow(paint({ isTicketActivity: true })), false);
    assert.equal(isRestyledRow(paint({ ticketPreview: {} as never })), true);
    assert.equal(isRestyledRow(paint({ recordingPreview: {} as never })), false);
  });

  it('reads a sender of "system" as no sender', () => {
    const ticket = { rowKind: 'TICKET', ticketPreview: {} as never } as const;
    assert.equal(isRestyledRow(paint(ticket)), true);
    assert.equal(
      isRestyledRow(paint({ ...ticket, senderPaintModel: { senderId: 'system' } as never })),
      false,
    );
  });

  it('takes the flow card and hydration facts from the caller', () => {
    assert.equal(isRestyledRow(paint(), { isFlowJson: true }), false);
    assert.equal(isRestyledRow(paint(), { hasConversation: false }), false);
  });
});

describe('isUnreadableMessage', () => {
  it('is true only while the message is still ciphertext', () => {
    assert.equal(isUnreadableMessage('ENC:v1|key|abc'), true);
    assert.equal(isUnreadableMessage(':::initialMessage\nmessageId: m1'), false);
    assert.equal(isUnreadableMessage(''), false);
    assert.equal(isUnreadableMessage(null), false);
    assert.equal(isUnreadableMessage(undefined), false);
  });
});
