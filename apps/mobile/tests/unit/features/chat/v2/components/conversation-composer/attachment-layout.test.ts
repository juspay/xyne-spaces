import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_GRID_HEIGHT,
  FILE_ATTACHMENT_CARD_HEIGHT,
  formatAttachmentDuration,
} from '@/src/features/chat/v2/components/conversation-composer/attachment-layout';

describe('attachment layout constants', () => {
  it('exposes the grid and card dimensions', () => {
    assert.equal(ATTACHMENT_GRID_HEIGHT, 180);
    assert.equal(ATTACHMENT_GRID_GAP, 2);
    assert.equal(FILE_ATTACHMENT_CARD_HEIGHT, 74);
  });
});

describe('formatAttachmentDuration', () => {
  it('formats sub-minute durations as m:ss', () => {
    assert.equal(formatAttachmentDuration(0), '0:00');
    assert.equal(formatAttachmentDuration(5), '0:05');
    assert.equal(formatAttachmentDuration(45), '0:45');
  });

  it('formats minutes with zero-padded seconds', () => {
    assert.equal(formatAttachmentDuration(65), '1:05');
    assert.equal(formatAttachmentDuration(600), '10:00');
  });

  it('switches to h:mm:ss past an hour', () => {
    assert.equal(formatAttachmentDuration(3600), '1:00:00');
    assert.equal(formatAttachmentDuration(3661), '1:01:01');
    assert.equal(formatAttachmentDuration(7325), '2:02:05');
  });

  it('rounds fractional seconds to the nearest second', () => {
    assert.equal(formatAttachmentDuration(59.6), '1:00');
    assert.equal(formatAttachmentDuration(45.4), '0:45');
  });
});
