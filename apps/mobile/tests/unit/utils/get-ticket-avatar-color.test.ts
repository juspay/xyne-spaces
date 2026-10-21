import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getTicketAvatarColor,
  getTicketAvatarInitial,
} from '@/src/features/xyne-desks/tickets/utils/get-ticket-avatar-color';
import { TICKET_AVATAR_COLORS } from '@/src/features/xyne-desks/tickets/constants';

const PALETTE = TICKET_AVATAR_COLORS as readonly string[];

describe('getTicketAvatarColor', () => {
  it('is deterministic for the same seed', () => {
    assert.equal(getTicketAvatarColor('ticket-42'), getTicketAvatarColor('ticket-42'));
  });

  it('always returns a color from the palette', () => {
    for (const seed of ['', 'a', 'Alice', 'a-very-long-seed-value-123', '🎫']) {
      assert.ok(PALETTE.includes(getTicketAvatarColor(seed)), `unexpected color for "${seed}"`);
    }
  });
});

describe('getTicketAvatarInitial', () => {
  it('returns the uppercased first non-space character', () => {
    assert.equal(getTicketAvatarInitial('  alice'), 'A');
    assert.equal(getTicketAvatarInitial('bob'), 'B');
  });

  it('falls back to "?" for empty or whitespace-only names', () => {
    assert.equal(getTicketAvatarInitial(''), '?');
    assert.equal(getTicketAvatarInitial('   '), '?');
  });
});
