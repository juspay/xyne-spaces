import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupCustomEmojiMarkdownSegmentsByLine as groupLegacyCustomEmojiMarkdownSegmentsByLine,
  parseCustomEmojiMarkdownSegments as parseLegacyCustomEmojiMarkdownSegments,
} from '@/src/components/conversation-composer/utils/parseCustomEmojiMarkdownSegments';
import {
  groupCustomEmojiMarkdownSegmentsByLine,
  parseCustomEmojiMarkdownSegments,
} from '@/src/features/chat/v2/components/conversation-composer/utils/parseCustomEmojiMarkdownSegments';

const gluedEmojiMarkdown = 'helloxemoji:abc:wave:emojixworld\nnext';

describe('groupCustomEmojiMarkdownSegmentsByLine', () => {
  it('keeps glued emoji text on the first row and starts the next markdown line at the start', () => {
    const lines = groupCustomEmojiMarkdownSegmentsByLine(
      parseCustomEmojiMarkdownSegments(gluedEmojiMarkdown),
    );

    assert.deepEqual(lines, [
      [
        { type: 'markdown', markdown: 'hello' },
        { type: 'customEmoji', emojiId: 'abc', name: 'wave' },
        { type: 'markdown', markdown: 'world' },
      ],
      [{ type: 'markdown', markdown: 'next' }],
    ]);
  });

  it('keeps a blank markdown line between emoji text', () => {
    const lines = groupCustomEmojiMarkdownSegmentsByLine(
      parseCustomEmojiMarkdownSegments('helloxemoji:abc:wave:emojixworld\n\nnext'),
    );

    assert.deepEqual(lines, [
      [
        { type: 'markdown', markdown: 'hello' },
        { type: 'customEmoji', emojiId: 'abc', name: 'wave' },
        { type: 'markdown', markdown: 'world' },
      ],
      [],
      [{ type: 'markdown', markdown: 'next' }],
    ]);
  });

  it('keeps the legacy parser aligned for glued emoji line breaks', () => {
    assert.deepEqual(
      groupLegacyCustomEmojiMarkdownSegmentsByLine(
        parseLegacyCustomEmojiMarkdownSegments(gluedEmojiMarkdown),
      ),
      groupCustomEmojiMarkdownSegmentsByLine(parseCustomEmojiMarkdownSegments(gluedEmojiMarkdown)),
    );
  });
});
