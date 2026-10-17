import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FILE_ATTACHMENT_CARD_PREFERRED_MIN_WIDTH,
  getChatBubbleContentMinAvailableWidth,
  getFileAttachmentCardMinWidth,
} from '@/src/components/conversation-composer/attachment-layout';

// Content box of each bubble surface, mirrored from the row/bubble styles.
const v2ChannelContent = (w: number): number => Math.min(w * 0.78 - 12, (w - 32) * 0.78) - 16;
const v2ThreadContent = (w: number): number => Math.min(w * 0.78 - 12, (w - 24) * 0.78) - 16;
const v3Content = (w: number): number => Math.min(w * 0.78 - 12, w - 32) - 16;

describe('getFileAttachmentCardMinWidth', () => {
  for (const w of [320, 346, 360, 375, 384, 393, 412, 430]) {
    it(`fits inside every chat bubble surface on a ${w}dp viewport`, () => {
      const min = getFileAttachmentCardMinWidth(w);
      assert.ok(min <= v2ChannelContent(w), `v2 channel @${w}`);
      assert.ok(min <= v2ThreadContent(w), `v2 thread @${w}`);
      assert.ok(min <= v3Content(w), `v3 @${w}`);
    });
  }

  for (const w of [390, 393, 402, 412, 430]) {
    it(`keeps the 256dp preference on a ${w}dp viewport`, () => {
      assert.equal(getFileAttachmentCardMinWidth(w), FILE_ATTACHMENT_CARD_PREFERRED_MIN_WIDTH);
    });
  }

  it('clamps to the bubble on narrow viewports and never goes negative', () => {
    assert.equal(getFileAttachmentCardMinWidth(346), getChatBubbleContentMinAvailableWidth(346));
    assert.equal(getFileAttachmentCardMinWidth(0), 0);
  });
});
