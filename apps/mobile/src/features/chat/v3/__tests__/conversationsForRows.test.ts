import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conversationsForRows } from '../data/conversationsForRows';
import { EMPTY_WINDOW, type Conversation } from '../data/normalizeConversationWindow';
import type { WarmRow, WarmWindow } from '../warm/warmWindow.types';

const asConversations = (rows: readonly object[]): readonly Conversation[] =>
  rows as readonly Conversation[];

const warm = (records: readonly object[]): WarmWindow => ({
  kind: 'channel',
  id: 'ch-1',
  rows: records.map((row): WarmRow => {
    const conversationId = (row as { conversationId?: string }).conversationId;
    return conversationId ? { conversationId } : {};
  }),
  records,
  fingerprint: 'warm',
  readAt: 1,
  containsTarget: true,
});

describe('conversationsForRows', (): void => {
  it('paints warm records while the live window is still hydrating', (): void => {
    const record = { conversationId: 'c-warm', initialMessageMd: 'hello' };
    const rows = conversationsForRows(EMPTY_WINDOW, warm([record]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0], record);
  });

  it('keeps warm rows when live is empty, including a settled empty window', (): void => {
    const record = { conversationId: 'c-warm', initialMessageMd: 'hello' };
    const settledEmpty = {
      ...EMPTY_WINDOW,
      isInitialLoadComplete: true,
    };
    const rows = conversationsForRows(settledEmpty, warm([record]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0], record);
  });

  it('keeps warm rows until live is settled, even if live already has a page', (): void => {
    const live = asConversations([{ conversationId: 'c-live' }]);
    const cached = { conversationId: 'c-warm', initialMessageMd: 'hello' };
    const hydrating = {
      ...EMPTY_WINDOW,
      conversations: live,
    };
    assert.equal(conversationsForRows(hydrating, warm([cached]))[0], cached);

    const settled = {
      ...EMPTY_WINDOW,
      conversations: live,
      isInitialLoadComplete: true,
    };
    assert.equal(conversationsForRows(settled, warm([cached])), live);
  });

  it('paints warm rows for an anchored open that cannot land yet', (): void => {
    const tailWarm = warm([{ conversationId: 'c-latest' }]);
    tailWarm.containsTarget = false;
    const rows = conversationsForRows(EMPTY_WINDOW, tailWarm, {
      kind: 'anchor',
      conversationId: 'c-old',
      messageId: 'c-old',
      createdAt: 10,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.conversationId, 'c-latest');
  });

  it('paints warm immediately when the cache already contains the anchor', (): void => {
    const record = { conversationId: 'c-old', initialMessageMd: 'hello' };
    const rows = conversationsForRows(EMPTY_WINDOW, warm([record]), {
      kind: 'anchor',
      conversationId: 'c-old',
      messageId: 'c-old',
      createdAt: 10,
    });
    assert.equal(rows[0], record);
  });

  it('keeps warm when live is settled but not authoritative for the anchor', (): void => {
    const live = asConversations([{ conversationId: 'c-latest' }]);
    const cached = { conversationId: 'c-old', initialMessageMd: 'hello' };
    const settled = {
      ...EMPTY_WINDOW,
      conversations: live,
      isInitialLoadComplete: true,
    };
    const rows = conversationsForRows(settled, warm([cached]), {
      kind: 'anchor',
      conversationId: 'c-old',
      messageId: 'c-old',
      createdAt: 10,
    });
    assert.equal(rows[0], cached);
  });

  it('paints a settled live window even when the anchor is not in this page', (): void => {
    const live = asConversations([{ conversationId: 'c-latest' }]);
    const settled = {
      ...EMPTY_WINDOW,
      conversations: live,
      isInitialLoadComplete: true,
    };
    const rows = conversationsForRows(settled, null, {
      kind: 'anchor',
      conversationId: 'c-old',
      messageId: 'c-old',
      createdAt: 10,
    });
    assert.equal(rows, live);
  });
});
