import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasCustomEmojiInComposerHtml } from '@/src/utils/composerCustomEmojiHtml';

describe('hasCustomEmojiInComposerHtml', () => {
  it('returns false for empty or plain html', () => {
    assert.equal(hasCustomEmojiInComposerHtml(''), false);
    assert.equal(hasCustomEmojiInComposerHtml('hello world'), false);
    assert.equal(hasCustomEmojiInComposerHtml('<p>no images here</p>'), false);
  });

  it('detects an <img> carrying a data-emoji-id attribute', () => {
    assert.equal(hasCustomEmojiInComposerHtml('<img data-emoji-id="abc123" alt=":x:">'), true);
    assert.equal(hasCustomEmojiInComposerHtml("<img data-emoji-id='abc123'>"), true);
  });

  it('detects the API emoji stream src', () => {
    assert.equal(hasCustomEmojiInComposerHtml('<img src="/api/emojis/xyz/stream">'), true);
  });

  it('detects a native cached file:// emoji src', () => {
    assert.equal(
      hasCustomEmojiInComposerHtml('<img src="file:///var/cache/emojis/foo.png">'),
      true,
    );
  });

  it('ignores unrelated remote images', () => {
    assert.equal(hasCustomEmojiInComposerHtml('<img src="https://example.com/pic.png">'), false);
    assert.equal(hasCustomEmojiInComposerHtml('<img src="file:///var/photos/foo.png">'), false);
  });

  it('is case-insensitive on the tag/attribute', () => {
    assert.equal(hasCustomEmojiInComposerHtml('<IMG DATA-EMOJI-ID="abc">'), true);
  });
});
