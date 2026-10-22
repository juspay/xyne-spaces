import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getChatPaintPreviewMode,
  groupPaintPreviewSegmentsByLine,
  shouldKeepChatPaintPreview,
} from '@/src/features/chat/v2/components/chat/chat-paint-preview-policy';

describe('shouldKeepChatPaintPreview', () => {
  it('keeps collapsible messages on paint preview so Read more does not remount the row', () => {
    assert.equal(
      shouldKeepChatPaintPreview({
        isCollapsible: true,
        isForwardedMessage: false,
        isFlowJsonMessage: false,
        customEmojiCount: 0,
        hasMediaPlaceholder: false,
      }),
      true,
    );
  });

  it('keeps emoji+text messages on paint preview so promotion does not remount images', () => {
    assert.equal(
      shouldKeepChatPaintPreview({
        isCollapsible: false,
        isForwardedMessage: false,
        isFlowJsonMessage: false,
        customEmojiCount: 1,
        hasMediaPlaceholder: false,
      }),
      true,
    );
  });

  it('still promotes forwarded, flow, and emoji+media rows that need the rich shell', () => {
    assert.equal(
      shouldKeepChatPaintPreview({
        isCollapsible: true,
        isForwardedMessage: true,
        isFlowJsonMessage: false,
        customEmojiCount: 0,
        hasMediaPlaceholder: false,
      }),
      false,
    );
    assert.equal(
      shouldKeepChatPaintPreview({
        isCollapsible: false,
        isForwardedMessage: false,
        isFlowJsonMessage: true,
        customEmojiCount: 0,
        hasMediaPlaceholder: false,
      }),
      false,
    );
    assert.equal(
      shouldKeepChatPaintPreview({
        isCollapsible: false,
        isForwardedMessage: false,
        isFlowJsonMessage: false,
        customEmojiCount: 1,
        hasMediaPlaceholder: true,
      }),
      false,
    );
  });
});

describe('groupPaintPreviewSegmentsByLine', () => {
  it('keeps glued emoji text on the first row and starts the next line at the start', () => {
    const lines = groupPaintPreviewSegmentsByLine([
      { kind: 'text', text: 'hello' },
      { kind: 'emoji', emojiId: 'abc', name: 'wave', text: '' },
      { kind: 'text', text: 'world\nnext' },
    ]);

    assert.deepEqual(lines, [
      [
        { kind: 'text', text: 'hello' },
        { kind: 'emoji', emojiId: 'abc', name: 'wave', text: '' },
        { kind: 'text', text: 'world' },
      ],
      [{ kind: 'text', text: 'next' }],
    ]);
  });
});

describe('getChatPaintPreviewMode', () => {
  it('classifies a custom-emoji body as emoji even when other inline runs exist', () => {
    assert.equal(
      getChatPaintPreviewMode({
        inlineMarkdown: undefined,
        plainText: 'hello',
        segments: [
          { kind: 'text', text: 'hello' },
          { kind: 'emoji', emojiId: 'abc', name: 'wave', text: '' },
        ],
      }),
      'emoji',
    );
  });
});
