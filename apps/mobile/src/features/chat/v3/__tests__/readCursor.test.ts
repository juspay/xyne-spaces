import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { advanceReadCursor, flushDecision } from '../read/readCursor';

describe('advanceReadCursor', (): void => {
  it('advances only at the tail', (): void => {
    const row = { conversationId: 'c-1', createdAt: 20 };
    assert.equal(advanceReadCursor(null, row, false), null);
    assert.deepEqual(advanceReadCursor(null, row, true), row);
    assert.deepEqual(advanceReadCursor({ conversationId: 'c-0', createdAt: 10 }, row, true), row);
    assert.deepEqual(advanceReadCursor({ conversationId: 'c-2', createdAt: 30 }, row, true), {
      conversationId: 'c-2',
      createdAt: 30,
    });
  });

  it('keeps the same cursor object when the tail message has not moved', (): void => {
    const cursor = { conversationId: 'c-1', createdAt: 20 };
    assert.equal(advanceReadCursor(cursor, { conversationId: 'c-1', createdAt: 20 }, true), cursor);
  });
});

describe('flushDecision', (): void => {
  const cursor = { conversationId: 'c-1', createdAt: 50 };

  it('skips when mark-as-unread was just set', (): void => {
    assert.deepEqual(flushDecision('leave', cursor, true, true, 100), { kind: 'skip' });
    assert.deepEqual(flushDecision('background', cursor, true, true, 100), { kind: 'skip' });
    assert.deepEqual(flushDecision('viewing', cursor, true, true, 100), { kind: 'skip' });
  });

  it('defers leave and background when status is unknown', (): void => {
    assert.deepEqual(flushDecision('leave', cursor, false, false, 100), { kind: 'defer' });
    assert.deepEqual(flushDecision('background', cursor, false, false, 100), { kind: 'defer' });
    assert.deepEqual(flushDecision('viewing', cursor, false, false, 100), { kind: 'skip' });
  });

  it('flushes with max(createdAt, now) and conversationId', (): void => {
    assert.deepEqual(flushDecision('leave', cursor, true, false, 40), {
      kind: 'flush',
      timestamp: 50,
      conversationId: 'c-1',
    });
    assert.deepEqual(flushDecision('leave', cursor, true, false, 80), {
      kind: 'flush',
      timestamp: 80,
      conversationId: 'c-1',
    });
    assert.deepEqual(flushDecision('viewing', null, true, false, 80), { kind: 'skip' });
  });
});
