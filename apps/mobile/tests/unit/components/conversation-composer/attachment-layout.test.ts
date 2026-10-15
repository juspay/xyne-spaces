import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATTACHMENT_GRID_HEIGHT,
  ATTACHMENT_GRID_GAP,
  FILE_ATTACHMENT_CARD_HEIGHT,
} from '@/src/components/conversation-composer/attachment-layout';

describe('conversation-composer attachment layout constants', () => {
  it('pins the current attachment layout metrics', () => {
    assert.equal(ATTACHMENT_GRID_HEIGHT, 180);
    assert.equal(ATTACHMENT_GRID_GAP, 2);
    assert.equal(FILE_ATTACHMENT_CARD_HEIGHT, 74);
  });

  it('are positive, finite pixel values', () => {
    for (const value of [
      ATTACHMENT_GRID_HEIGHT,
      ATTACHMENT_GRID_GAP,
      FILE_ATTACHMENT_CARD_HEIGHT,
    ]) {
      assert.ok(Number.isFinite(value) && value > 0, `${value} should be a positive pixel value`);
    }
  });

  it('keeps the media grid taller than a single file card', () => {
    assert.ok(ATTACHMENT_GRID_HEIGHT > FILE_ATTACHMENT_CARD_HEIGHT);
  });
});
