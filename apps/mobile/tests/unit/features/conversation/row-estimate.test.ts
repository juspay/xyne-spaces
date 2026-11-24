import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONTINUATION_TOP_OFFSET as CONTINUATION_TOP,
  FILE_CARD_MIN_HEIGHT as FILE_CARD,
  MESSAGE_BODY_LINE_HEIGHT as LINE,
  MESSAGE_EXTRAS_GAP as GAP,
  MESSAGE_PADDING_Y as PAD,
  PULL_REQUEST_TITLE_MAX_LINES,
  REACTION_CHIP_HEIGHT as CHIPS,
  READ_MORE_BLOCK_HEIGHT as READ_MORE,
  THREAD_STRIP_HEIGHT as STRIP,
} from '@/src/features/conversation/constants';
import { pullRequestCardHeight } from '@/src/features/conversation/model/pull-request';
import {
  estimateCardsHeight,
  estimateFlatMessageHeight,
  wrappedLineCount,
} from '@/src/features/conversation/model/row-estimate';
import { ticketCardHeight } from '@/src/features/conversation/model/ticket-card';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

const row = (overrides: Partial<ChatPaintRow>): ChatPaintRow => {
  const text = overrides.plainPreviewText ?? '';
  return {
    rowKind: 'OTHER_USER',
    senderPaintModel: { senderId: 'u1' },
    plainPreviewText: text,
    body: { markdown: text, plainText: text },
    reactionSummaryCount: 0,
    replyCount: 0,
    replyPreview: null,
    reactionPreview: null,
    mediaPlaceholder: null,
    ticketPreview: null,
    linkPreview: null,
    ...overrides,
  } as ChatPaintRow;
};

const layout = { bodyWidth: 300, charsPerLine: 40 };
// The row's own sizes, private to the estimate.
const MIN_ROW = 56;
const NAME_LINE = 20;
const LINK_PREVIEW = 86;
const SHORT = PAD + PAD + NAME_LINE + LINE;

describe('wrappedLineCount', () => {
  it('counts explicit and wrapped lines', () => {
    assert.equal(wrappedLineCount('', 10), 0);
    assert.equal(wrappedLineCount('abc', 10), 1);
    assert.equal(wrappedLineCount('a'.repeat(25), 10), 3);
    assert.equal(wrappedLineCount('a\n\nb', 10), 3);
  });
});

describe('estimateFlatMessageHeight', () => {
  it('never goes below the minimum', () => {
    assert.equal(estimateFlatMessageHeight(row({ plainPreviewText: '' }), layout), MIN_ROW);
  });

  it('adds padding, the name line and one text line to a short message', () => {
    assert.equal(estimateFlatMessageHeight(row({ plainPreviewText: 'hi' }), layout), SHORT);
  });

  it('grows with the wrapped text', () => {
    const short = estimateFlatMessageHeight(row({ plainPreviewText: 'a'.repeat(40) }), layout);
    const long = estimateFlatMessageHeight(row({ plainPreviewText: 'a'.repeat(120) }), layout);
    assert.equal(long - short, 2 * LINE);
  });

  it('adds room for reactions and a thread', () => {
    const plain = estimateFlatMessageHeight(row({ plainPreviewText: 'hi' }), layout);
    const busy = estimateFlatMessageHeight(
      row({ plainPreviewText: 'hi', reactionSummaryCount: 2, replyCount: 3 }),
      layout,
    );
    assert.equal(busy - plain, CHIPS + GAP + STRIP + GAP);
  });
});

describe('estimateFlatMessageHeight for a continuation', () => {
  const sender = { senderId: 'u1' } as ChatPaintRow['senderPaintModel'];
  const previous = row({ createdAt: 1_000_000, senderPaintModel: sender });
  const next = row({ createdAt: 1_060_000, senderPaintModel: sender, plainPreviewText: 'hi' });

  it('drops the name line and pulls up under the row above', () => {
    assert.equal(estimateFlatMessageHeight(next, layout, previous), CONTINUATION_TOP + PAD + LINE);
    assert.equal(estimateFlatMessageHeight(next, layout), SHORT);
  });

  it('keeps the name line under a row the flat layout does not restyle', () => {
    const recording = { ...previous, recordingPreview: {} as never };
    assert.equal(estimateFlatMessageHeight(next, layout, recording), SHORT);
  });
});

describe('estimateFlatMessageHeight for a long message', () => {
  it('reserves the folded lines and Read more, not the whole text', () => {
    const long = row({ plainPreviewText: 'word '.repeat(400).trim() });
    // Folded to 11 lines.
    assert.equal(
      estimateFlatMessageHeight(long, layout),
      PAD + PAD + NAME_LINE + 11 * LINE + READ_MORE,
    );
  });
});

describe('estimateFlatMessageHeight for attachments', () => {
  const attachment = (id: string, mimetype: string, originalFilename: string) => ({
    id,
    mimetype,
    originalFilename,
  });
  const withAttachments = (
    attachments: ReturnType<typeof attachment>[],
    aspectRatio: number | null,
  ): ChatPaintRow =>
    row({
      plainPreviewText: 'hi',
      mediaPlaceholder: { attachments, aspectRatio } as ChatPaintRow['mediaPlaceholder'],
    });
  const plain = estimateFlatMessageHeight(row({ plainPreviewText: 'hi' }), layout);

  it('reserves the photo grid at the size it draws', () => {
    const wide = withAttachments([attachment('a', 'image/png', 'a.png')], 1.6);
    assert.equal(estimateFlatMessageHeight(wide, layout) - plain, 187.5 + GAP);
    const four = withAttachments(
      ['a', 'b', 'c', 'd', 'e'].map(id => attachment(id, 'image/jpeg', `${id}.jpg`)),
      null,
    );
    assert.equal(estimateFlatMessageHeight(four, layout) - plain, 300 + GAP);
  });

  it('lays out a photo with a zero side at the unknown shape, as the grid does', () => {
    const photo = [attachment('a', 'image/png', 'a.png')];
    assert.equal(
      estimateFlatMessageHeight(withAttachments(photo, 0), layout),
      estimateFlatMessageHeight(withAttachments(photo, null), layout),
    );
  });

  it('adds a file card per file under the grid', () => {
    const mixed = withAttachments(
      [
        attachment('a', 'image/png', 'a.png'),
        attachment('b', 'application/pdf', 'b.pdf'),
        attachment('c', 'text/csv', 'c.csv'),
      ],
      0.5,
    );
    assert.equal(
      estimateFlatMessageHeight(mixed, layout) - plain,
      300 + GAP + 2 * (FILE_CARD + GAP),
    );
  });
});

describe('estimateCardsHeight', () => {
  const ticket = {
    ticketId: 'XYN-1',
    title: 'short',
    description: null,
    statusLabel: 'To do',
    priority: null,
  };
  const link = (url: string): ChatPaintRow['linkPreview'] => ({
    url,
    host: 'github.com',
    title: 'github.com',
    description: null,
  });

  it('puts a ticket card right under the header of a row with no words', () => {
    const card = ticketCardHeight(1);
    assert.equal(estimateCardsHeight(row({ ticketPreview: ticket }), 300, false), card);
    assert.equal(estimateCardsHeight(row({ ticketPreview: ticket }), 300, true), card + GAP);
  });

  it('sizes a pull request link as its card and any other link as the preview', () => {
    const pr = row({ linkPreview: link('https://github.com/a/b/pull/1') });
    assert.equal(
      estimateCardsHeight(pr, 300, true),
      pullRequestCardHeight(PULL_REQUEST_TITLE_MAX_LINES) + GAP,
    );
    const other = row({ linkPreview: link('https://example.com') });
    assert.equal(estimateCardsHeight(other, 300, true), LINK_PREVIEW + GAP);
  });
});
