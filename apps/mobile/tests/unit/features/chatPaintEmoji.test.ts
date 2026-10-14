import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { collectPaintEmojiIds } from '@/src/features/chat/v2/paint/chatPaintEmoji';

describe('chat paint emoji dependencies', () => {
  it('collects and dedupes body and parent-preview emoji ids', () => {
    const row = {
      body: { customEmojiIds: ['body', 'shared'] },
      parentPreview: { customEmojiIds: ['parent', 'shared'] },
    } as unknown as ChatPaintRow;

    assert.deepEqual(collectPaintEmojiIds([row]).sort(), ['body', 'parent', 'shared']);
  });
});
