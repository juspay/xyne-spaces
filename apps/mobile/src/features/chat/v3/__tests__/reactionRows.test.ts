import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RawReaction } from '@/src/components/chat/message/reactions/reaction-pill.utils';

import { reactionRowsFor } from '../overlays/reactionRows';

const raw = (over: Partial<RawReaction>): RawReaction => ({
  createdAt: 1,
  emojiName: '👍',
  messageId: 'm1',
  reactionId: 'r1',
  userId: 'u1',
  ...over,
});

describe('reactionRowsFor', (): void => {
  it('sorts by createdAt and labels the current user as You', (): void => {
    const rows = reactionRowsFor(
      [
        raw({ reactionId: 'later', userId: 'u2', createdAt: 20, emojiName: '🎉' }),
        raw({ reactionId: 'self', userId: 'me', createdAt: 10 }),
      ],
      (userId: string) =>
        userId === 'me'
          ? { name: 'Vinit', picture: 'me.png' }
          : { name: 'Ada', picture: 'ada.png' },
      'me',
    );
    assert.deepEqual(
      rows.map(item => item.reactionId),
      ['self', 'later'],
    );
    assert.equal(rows[0]?.name, 'You');
    assert.equal(rows[0]?.isSelf, true);
    assert.equal(rows[1]?.name, 'Ada');
    assert.equal(rows[1]?.isSelf, false);
  });

  it('falls back to Unknown when the user cannot be resolved', (): void => {
    const [row] = reactionRowsFor([raw({ userId: 'ghost' })], () => undefined, 'me');
    assert.equal(row?.name, 'Unknown');
    assert.equal(row?.picture, '');
    assert.equal(row?.isSelf, false);
  });
});
