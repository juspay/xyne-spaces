import {
  CHAT_PAINT_MEDIA_GRID_HEIGHT_PX,
  estimateCharsPerLine,
} from '@/src/features/chat/v2/paint/chatPaintSizing';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  CONTINUATION_TOP_OFFSET,
  MESSAGE_BODY_HORIZONTAL_CHROME,
  MESSAGE_EXTRAS_GAP,
  MESSAGE_PADDING_Y,
  REACTION_CHIP_HEIGHT,
  THREAD_STRIP_HEIGHT,
} from '../constants';
import { isContinuationRow } from './grouping';

const MIN_ROW_HEIGHT = 56;
const NAME_LINE_HEIGHT = 20;
const TEXT_LINE_HEIGHT = 20;
const LINK_PREVIEW_HEIGHT = 86;

/** How many lines `text` takes at `charsPerLine` characters a line. */
export function wrappedLineCount(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * A guess at a flat row's height, good enough to seed the list's item size:
 * the name line, the wrapped words, and a fixed amount per extra under them.
 * A continuation of `previous` has no name line and pulls up under it.
 */
export function estimateFlatMessageHeight(
  row: ChatPaintRow,
  charsPerLine: number,
  previous?: ChatPaintRow,
): number {
  const continuation = isContinuationRow(previous, row);
  const text = (row.body?.plainText ?? row.plainPreviewText).trim();
  const reactionCount = row.reactionPreview?.totalCount ?? row.reactionSummaryCount;
  const replyCount = row.replyPreview?.count ?? row.replyCount;
  const media =
    row.media?.reservedHeightPx ?? (row.mediaPlaceholder ? CHAT_PAINT_MEDIA_GRID_HEIGHT_PX : 0);

  const extras =
    (media > 0 ? media + MESSAGE_EXTRAS_GAP : 0) +
    (row.linkPreview ? LINK_PREVIEW_HEIGHT + MESSAGE_EXTRAS_GAP : 0) +
    (reactionCount > 0 ? REACTION_CHIP_HEIGHT + MESSAGE_EXTRAS_GAP : 0) +
    (replyCount > 0 ? THREAD_STRIP_HEIGHT + MESSAGE_EXTRAS_GAP : 0);

  const top = continuation ? CONTINUATION_TOP_OFFSET : MESSAGE_PADDING_Y;
  const nameLine = continuation ? 0 : NAME_LINE_HEIGHT;
  const height =
    top +
    MESSAGE_PADDING_Y +
    nameLine +
    wrappedLineCount(text, charsPerLine) * TEXT_LINE_HEIGHT +
    extras;

  return continuation ? Math.max(TEXT_LINE_HEIGHT, height) : Math.max(MIN_ROW_HEIGHT, height);
}

/** Characters a line of the flat body holds on a screen `windowWidth` wide. */
export function flatCharsPerLine(windowWidth: number): number {
  return estimateCharsPerLine(windowWidth - MESSAGE_BODY_HORIZONTAL_CHROME);
}
