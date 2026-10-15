import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatUnreadLabel } from '@/src/components/chat/channel-list/channel-list.utils';

describe('formatUnreadLabel', () => {
  it('shows the exact unread count through 99', () => {
    assert.equal(formatUnreadLabel(1), '1');
    assert.equal(formatUnreadLabel(99), '99');
  });

  it('caps unread counts above 99 as 99+', () => {
    assert.equal(formatUnreadLabel(100), '99+');
  });
});
