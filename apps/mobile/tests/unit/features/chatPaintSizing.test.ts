import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateCharsPerLine,
  estimateChatPaintRowHeight,
  getDateRowEstimatedHeight,
  getUnreadDividerRowHeight,
  CHAT_LIST_INITIAL_ITEM_SIZE,
} from '@/src/features/chat/v2/paint/chatPaintSizing';

describe('estimateCharsPerLine', () => {
  it('derives chars-per-line from the container width', () => {
    // 300 / 8.8 ≈ 34.09 -> 34, the calibrated default.
    assert.equal(estimateCharsPerLine(300), 34);
  });

  it('never returns fewer than 16 chars for narrow widths', () => {
    assert.equal(estimateCharsPerLine(100), 16);
  });

  it('falls back to the default (34) for non-finite or non-positive widths', () => {
    assert.equal(estimateCharsPerLine(0), 34);
    assert.equal(estimateCharsPerLine(-50), 34);
    assert.equal(estimateCharsPerLine(Number.NaN), 34);
  });

  it('scales up for wider containers', () => {
    assert.ok(estimateCharsPerLine(600) > estimateCharsPerLine(300));
  });
});

describe('fixed row heights', () => {
  it('date row and unread divider are constant', () => {
    assert.equal(getDateRowEstimatedHeight(), 36);
    assert.equal(getUnreadDividerRowHeight(), 30);
  });
});

describe('estimateChatPaintRowHeight', () => {
  const base = (extra: Record<string, unknown> = {}) =>
    estimateChatPaintRowHeight({ previewText: 'hi', rowType: 'message', ...extra });

  it('a short single-line message is the initial item size (72)', () => {
    assert.equal(base(), CHAT_LIST_INITIAL_ITEM_SIZE);
    assert.equal(base(), 72);
  });

  it('grows by ~20px per wrapped text line', () => {
    // Three explicit lines -> 52 chrome + 3 * 20 text = 112.
    assert.equal(estimateChatPaintRowHeight({ previewText: 'a\nb\nc', rowType: 'message' }), 112);
  });

  it('adds the sender-name band when showSenderName is set', () => {
    assert.equal(base({ showSenderName: true }) - base(), 26);
  });

  it('adds a reply band when there are replies', () => {
    assert.equal(base({ replyCount: 2 }) - base(), 34);
  });

  it('adds a link-preview band', () => {
    assert.equal(base({ hasLinkPreview: true }) - base(), 86);
  });

  it('adds a reaction band when reactions are present', () => {
    assert.equal(base({ reactionSummaryCount: 3 }) - base(), 24);
  });

  it('an empty system row is the system minimum (56)', () => {
    assert.equal(estimateChatPaintRowHeight({ previewText: '', rowType: 'system' }), 56);
  });

  it('a ticket row uses the ticket minimum (228)', () => {
    assert.equal(estimateChatPaintRowHeight({ previewText: '', rowType: 'ticket' }), 228);
  });

  it('a media row reserves the media grid above its minimum', () => {
    // 52 chrome + 190 media grid = 242, above the 220 media floor.
    assert.equal(estimateChatPaintRowHeight({ previewText: '', rowType: 'media' }), 242);
  });

  it('wraps according to charsPerLine: a wider line packs into fewer rows', () => {
    const text = 'x'.repeat(40);
    const narrow = estimateChatPaintRowHeight({
      previewText: text,
      rowType: 'message',
      charsPerLine: 20,
    });
    const wide = estimateChatPaintRowHeight({
      previewText: text,
      rowType: 'message',
      charsPerLine: 100,
    });
    assert.ok(narrow > wide);
  });

  it('never returns less than the short-message minimum', () => {
    assert.ok(estimateChatPaintRowHeight({ previewText: '', rowType: 'message' }) >= 72);
  });
});
