import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getSenderAvatarFallbackUser,
  getSenderAvatarFallbackUsers,
} from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import type { SenderPaintModel } from '@/src/features/chat/v2/paint/chatPaint.types';

const sender: SenderPaintModel = {
  senderId: 'u1',
  displayName: 'Ada Lovelace',
  avatarUri: 'https://cdn.test/ada.png',
  isCurrentUser: false,
};

describe('getSenderAvatarFallbackUser', () => {
  it('maps a sender to an avatar fallback user', () => {
    assert.deepEqual(getSenderAvatarFallbackUser(sender), {
      id: 'u1',
      name: 'Ada Lovelace',
      displayName: 'Ada Lovelace',
      picture: 'https://cdn.test/ada.png',
    });
  });

  it('preserves a null avatar uri', () => {
    const result = getSenderAvatarFallbackUser({ ...sender, avatarUri: null });
    assert.equal(result?.picture, null);
  });

  it('returns undefined for null or undefined senders', () => {
    assert.equal(getSenderAvatarFallbackUser(null), undefined);
    assert.equal(getSenderAvatarFallbackUser(undefined), undefined);
  });

  it('returns undefined when the sender has no id', () => {
    assert.equal(getSenderAvatarFallbackUser({ ...sender, senderId: '' }), undefined);
  });
});

describe('getSenderAvatarFallbackUsers', () => {
  it('wraps a valid sender in a single-element array', () => {
    const users = getSenderAvatarFallbackUsers(sender);
    assert.equal(users.length, 1);
    assert.equal(users[0]?.id, 'u1');
  });

  it('returns an empty array when there is no fallback user', () => {
    assert.deepEqual(getSenderAvatarFallbackUsers(null), []);
    assert.deepEqual(getSenderAvatarFallbackUsers({ ...sender, senderId: '' }), []);
  });
});
