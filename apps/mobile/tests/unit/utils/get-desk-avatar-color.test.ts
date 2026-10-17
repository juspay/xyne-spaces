import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getDeskAvatarColor,
  getDeskInitial,
} from '@/src/features/xyne-desks/list/utils/get-desk-avatar-color';
import { DESK_AVATAR_COLORS } from '@/src/features/xyne-desks/list/constants';

const PALETTE = DESK_AVATAR_COLORS as readonly string[];

describe('getDeskAvatarColor', () => {
  it('is deterministic for the same seed', () => {
    assert.equal(getDeskAvatarColor('support'), getDeskAvatarColor('support'));
  });

  it('always returns a color from the palette', () => {
    for (const seed of ['', 'x', 'Support Desk', 'desk-9910', '📮']) {
      assert.ok(PALETTE.includes(getDeskAvatarColor(seed)), `unexpected color for "${seed}"`);
    }
  });
});

describe('getDeskInitial', () => {
  it('returns the uppercased first non-space character', () => {
    assert.equal(getDeskInitial('  support'), 'S');
    assert.equal(getDeskInitial('team'), 'T');
  });

  it('falls back to "?" for empty or whitespace-only names', () => {
    assert.equal(getDeskInitial(''), '?');
    assert.equal(getDeskInitial('   '), '?');
  });
});
