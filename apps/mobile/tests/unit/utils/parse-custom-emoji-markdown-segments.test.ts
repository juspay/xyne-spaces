import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupCustomEmojiMarkdownSegmentsByLine,
  hasCustomEmojiInMarkdown,
  parseCustomEmojiMarkdownSegments,
} from '@/src/components/conversation-composer/utils/parseCustomEmojiMarkdownSegments';

describe('hasCustomEmojiInMarkdown', () => {
  it('returns false for empty or plain markdown', () => {
    assert.equal(hasCustomEmojiInMarkdown(''), false);
    assert.equal(hasCustomEmojiInMarkdown('just text'), false);
  });

  it('detects the xemoji token form', () => {
    assert.equal(hasCustomEmojiInMarkdown('hi xemoji:smile:Smile:emojix'), true);
  });

  it('detects the file:// emoji image form', () => {
    assert.equal(hasCustomEmojiInMarkdown('![:s:](file://x/emojis/abc.png)'), true);
  });
});

describe('parseCustomEmojiMarkdownSegments', () => {
  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseCustomEmojiMarkdownSegments(''), []);
  });

  it('returns a single markdown segment when there is no emoji', () => {
    assert.deepEqual(parseCustomEmojiMarkdownSegments('plain text'), [
      { type: 'markdown', markdown: 'plain text' },
    ]);
  });

  it('splits text around an xemoji token', () => {
    const segments = parseCustomEmojiMarkdownSegments('hello xemoji:smile:Smile:emojix world');
    assert.equal(segments.length, 3);
    assert.deepEqual(segments[0], { type: 'markdown', markdown: 'hello ' });
    assert.deepEqual(segments[1], { type: 'customEmoji', emojiId: 'smile', name: 'Smile' });
    assert.deepEqual(segments[2], { type: 'markdown', markdown: ' world' });
  });

  it('url-decodes the emoji name from the token form', () => {
    const segments = parseCustomEmojiMarkdownSegments('xemoji:party:party%20time:emojix');
    assert.deepEqual(segments[0], { type: 'customEmoji', emojiId: 'party', name: 'party time' });
  });
});

describe('groupCustomEmojiMarkdownSegmentsByLine', () => {
  it('splits markdown segments onto separate lines at newlines', () => {
    const segments = parseCustomEmojiMarkdownSegments('a\nb');
    const lines = groupCustomEmojiMarkdownSegmentsByLine(segments);
    assert.deepEqual(lines, [
      [{ type: 'markdown', markdown: 'a' }],
      [{ type: 'markdown', markdown: 'b' }],
    ]);
  });

  it('keeps a custom emoji on the current line', () => {
    const segments = parseCustomEmojiMarkdownSegments('xemoji:smile:Smile:emojix');
    const lines = groupCustomEmojiMarkdownSegmentsByLine(segments);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], [{ type: 'customEmoji', emojiId: 'smile', name: 'Smile' }]);
  });
});
