import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import {
  CONTINUATION_WINDOW_MS,
  isContinuationRow,
} from '@/src/features/conversation/model/grouping';

const at = (hour: number, minute: number, day = 20): number =>
  new Date(2026, 9, day, hour, minute, 0, 0).getTime();

const row = (overrides: Partial<ChatPaintRow> = {}): ChatPaintRow =>
  ({
    rowKind: 'OTHER_USER',
    createdAt: at(10, 0),
    senderPaintModel: { senderId: 'u1' },
    replyCount: 0,
    replyPreview: null,
    ticketPreview: null,
    recordingPreview: null,
    ...overrides,
  }) as ChatPaintRow;

describe('isContinuationRow', () => {
  it('joins a message from the same sender a moment later', () => {
    assert.equal(isContinuationRow(row(), row({ createdAt: at(10, 2) })), true);
  });

  it('needs a row above', () => {
    assert.equal(isContinuationRow(undefined, row()), false);
  });

  it('breaks on a different sender', () => {
    const next = row({ createdAt: at(10, 1), senderPaintModel: { senderId: 'u2' } as never });
    assert.equal(isContinuationRow(row(), next), false);
  });

  it('allows exactly five minutes, not more, and never going backwards', () => {
    const start = at(10, 0);
    assert.equal(
      isContinuationRow(row(), row({ createdAt: start + CONTINUATION_WINDOW_MS })),
      true,
    );
    assert.equal(
      isContinuationRow(row(), row({ createdAt: start + CONTINUATION_WINDOW_MS + 1 })),
      false,
    );
    assert.equal(isContinuationRow(row(), row({ createdAt: start - 1 })), false);
  });

  it('breaks across midnight even inside five minutes', () => {
    const before = row({ createdAt: new Date(2026, 9, 20, 23, 58).getTime() });
    const after = row({ createdAt: new Date(2026, 9, 21, 0, 1).getTime() });
    assert.equal(isContinuationRow(before, after), false);
  });

  it('breaks after a deleted message', () => {
    assert.equal(isContinuationRow(row({ isDeleted: true }), row({ createdAt: at(10, 1) })), false);
  });

  it('ends the block at a thread strip, unless strips are not drawn', () => {
    const withReplies = row({ replyPreview: { count: 2 } as never });
    const next = row({ createdAt: at(10, 1) });
    assert.equal(isContinuationRow(withReplies, next), false);
    assert.equal(isContinuationRow(withReplies, next, { stripEndsBlock: false }), true);
    assert.equal(isContinuationRow(row({ replyCount: 1 }), next), false);
  });

  it('never joins system, ticket or recording rows, on either side', () => {
    const next = row({ createdAt: at(10, 1) });
    for (const odd of [
      row({ rowKind: 'SYSTEM' }),
      row({ rowKind: 'TICKET' }),
      row({ isTicketActivity: true }),
      row({ recordingPreview: {} as never }),
    ]) {
      assert.equal(isContinuationRow(odd, next), false);
      assert.equal(isContinuationRow(row(), { ...odd, createdAt: at(10, 1) }), false);
    }
  });

  it('joins a ticket card like any other flat message', () => {
    const ticket = row({ ticketPreview: {} as never, createdAt: at(10, 1) });
    assert.equal(isContinuationRow(row(), ticket), true);
  });

  it('never joins a flow card above', () => {
    const next = row({ createdAt: at(10, 1) });
    assert.equal(isContinuationRow(row(), next, { previousIsFlowJson: true }), false);
    assert.equal(isContinuationRow(row(), next, { previousIsFlowJson: false }), true);
  });

  it('keeps the header while the message shows a send status', () => {
    const next = row({ createdAt: at(10, 1) });
    assert.equal(isContinuationRow(row(), next, { showsSendStatus: true }), false);
  });
});
