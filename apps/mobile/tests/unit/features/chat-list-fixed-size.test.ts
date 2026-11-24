import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getChatRowFixedSize,
  resolveFixedItemSize,
  type ChatRow,
} from '@/src/features/chat/v2/components/chat/chat-list-rows';

const dateRow: ChatRow = { type: 'date', id: 'd', date: 0 };
const unreadRow: ChatRow = { type: 'unread-divider', id: 'u' };

describe('resolveFixedItemSize', () => {
  it('returns the classic function itself when no heights are given', () => {
    assert.equal(resolveFixedItemSize({}), getChatRowFixedSize);
  });

  it('fixes the date row only when a date height is given', () => {
    const resolve = resolveFixedItemSize({ dateRowHeight: 62 });
    assert.equal(resolve(dateRow), 62);
    assert.equal(resolve(unreadRow), getChatRowFixedSize(unreadRow));
  });

  it('overrides the unread divider height', () => {
    const resolve = resolveFixedItemSize({ unreadDividerHeight: 62 });
    assert.equal(resolve(unreadRow), 62);
    assert.equal(resolve(dateRow), undefined);
  });
});
