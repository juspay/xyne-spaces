import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUSTOM_EMOJIS_STALE_TIME_MS,
  customEmojisQueryKey,
  customEmojisQueryKeyForUser,
} from '@/src/services/customEmojiQuery';

describe('customEmojiQuery', () => {
  it('exposes a stable base query key', () => {
    assert.deepEqual(customEmojisQueryKey, ['custom-emojis']);
  });

  it('uses a 10 minute stale time', () => {
    assert.equal(CUSTOM_EMOJIS_STALE_TIME_MS, 10 * 60 * 1000);
  });

  it('scopes the query key by user id', () => {
    assert.deepEqual(customEmojisQueryKeyForUser('user-1'), ['custom-emojis', 'user-1']);
  });

  it('produces distinct keys for distinct users', () => {
    assert.notDeepEqual(
      customEmojisQueryKeyForUser('user-1'),
      customEmojisQueryKeyForUser('user-2'),
    );
  });
});
