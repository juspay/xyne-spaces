import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import { estimateCharsPerLine } from '@/src/features/chat/v2/paint/chatPaintSizing';
import type { ChatPaintRow, MediaPlaceholder } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  CONTINUATION_TOP_OFFSET,
  FILE_CARD_MIN_HEIGHT,
  MESSAGE_BODY_HORIZONTAL_CHROME,
  MESSAGE_BODY_LINE_HEIGHT,
  MESSAGE_EXTRAS_GAP,
  MESSAGE_PADDING_Y,
  PULL_REQUEST_TITLE_MAX_LINES,
  REACTION_CHIP_HEIGHT,
  READ_MORE_BLOCK_HEIGHT,
  THREAD_STRIP_HEIGHT,
} from '../constants';
import { flatCollapse } from './collapse';
import { isContinuationRow } from './grouping';
import { knownAspectRatio, photoGridLayout } from './photo-grid';
import { parsePullRequestUrl, pullRequestCardHeight } from './pull-request';
import { ticketCardHeight, TICKET_TITLE_INSET } from './ticket-card';

const MIN_ROW_HEIGHT = 56;
const NAME_LINE_HEIGHT = 20;
const TEXT_LINE_HEIGHT = MESSAGE_BODY_LINE_HEIGHT;
const LINK_PREVIEW_HEIGHT = 86;

/** How many lines `text` takes at `charsPerLine` characters a line. */
export function wrappedLineCount(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/** The flat body's width on a given screen, and the characters a line of it holds. */
type FlatTextLayout = { bodyWidth: number; charsPerLine: number };

/**
 * A guess at a flat row's height, good enough to seed the list's item size:
 * the name line, the wrapped words (or the folded lines and "Read more" of a
 * long message), and a fixed amount per extra under them. A continuation of
 * `previous` has no name line and pulls up under it.
 *
 * Grouping is judged from the paint rows alone, with the channel list's own
 * rule (a thread strip ends a block). Two facts the row knows are not in a
 * paint row: whether `previous` is a classic flow card and whether this row
 * shows a send status. Both only ever break a block, so the guess may call a
 * row a continuation that draws its header; the list measures it and corrects.
 */
export function estimateFlatMessageHeight(
  row: ChatPaintRow,
  { bodyWidth, charsPerLine }: FlatTextLayout,
  previous?: ChatPaintRow,
): number {
  const continuation = isContinuationRow(previous, row);
  const text = (row.body?.plainText ?? row.plainPreviewText).trim();
  const reactionCount = row.reactionPreview?.totalCount ?? row.reactionSummaryCount;
  const replyCount = row.replyPreview?.count ?? row.replyCount;

  const extras =
    estimateAttachmentsHeight(row.mediaPlaceholder, bodyWidth) +
    estimateCardsHeight(row, bodyWidth, text.length > 0) +
    (reactionCount > 0 ? REACTION_CHIP_HEIGHT + MESSAGE_EXTRAS_GAP : 0) +
    (replyCount > 0 ? THREAD_STRIP_HEIGHT + MESSAGE_EXTRAS_GAP : 0);

  const collapse = flatCollapse(row, bodyWidth);
  const words = collapse.isCollapsible
    ? collapse.collapsedLines * TEXT_LINE_HEIGHT + READ_MORE_BLOCK_HEIGHT
    : wrappedLineCount(text, charsPerLine) * TEXT_LINE_HEIGHT;

  const top = continuation ? CONTINUATION_TOP_OFFSET : MESSAGE_PADDING_Y;
  const nameLine = continuation ? 0 : NAME_LINE_HEIGHT;
  const height = top + MESSAGE_PADDING_Y + nameLine + words + extras;

  return continuation ? Math.max(TEXT_LINE_HEIGHT, height) : Math.max(MIN_ROW_HEIGHT, height);
}

/**
 * The attachments under the words, each with the gap above it: the photo grid
 * at the size it will draw (the first photo's shape is all the row knows), then
 * a file card per file.
 */
export function estimateAttachmentsHeight(
  placeholder: MediaPlaceholder | null,
  bodyWidth: number,
): number {
  if (!placeholder) return 0;
  const mediaCount = placeholder.attachments.filter(
    attachment => getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename) != null,
  ).length;
  const fileCount = placeholder.attachments.length - mediaCount;
  // The paint row's ratio is the first photo's or video's, as the grid reads it; read with the grid's rule.
  const grid = photoGridLayout(
    mediaCount,
    knownAspectRatio(placeholder.aspectRatio),
    bodyWidth,
  ).height;
  return (
    (mediaCount > 0 ? grid + MESSAGE_EXTRAS_GAP : 0) +
    fileCount * (FILE_CARD_MIN_HEIGHT + MESSAGE_EXTRAS_GAP)
  );
}

/**
 * The cards under the words: a ticket (right under the header when there are
 * no words, as on a ticket row), and a link's pull request card or preview.
 */
export function estimateCardsHeight(
  row: ChatPaintRow,
  bodyWidth: number,
  hasWords: boolean,
): number {
  const ticket = row.ticketPreview
    ? ticketCardHeight(
        wrappedLineCount(
          row.ticketPreview.title,
          estimateCharsPerLine(bodyWidth - TICKET_TITLE_INSET),
        ),
      ) + (hasWords ? MESSAGE_EXTRAS_GAP : 0)
    : 0;
  if (!row.linkPreview) return ticket;
  const pullRequest = parsePullRequestUrl(row.linkPreview.url);
  // The title the card shows arrives with the page's metadata, after this guess; two lines is the common case.
  const link = pullRequest
    ? pullRequestCardHeight(PULL_REQUEST_TITLE_MAX_LINES)
    : LINK_PREVIEW_HEIGHT;
  return ticket + link + MESSAGE_EXTRAS_GAP;
}

export function flatTextLayout(windowWidth: number): FlatTextLayout {
  const bodyWidth = flatBodyWidth(windowWidth);
  return { bodyWidth, charsPerLine: estimateCharsPerLine(bodyWidth) };
}

/** The flat body's width on a screen `windowWidth` wide. */
export function flatBodyWidth(windowWidth: number): number {
  return windowWidth - MESSAGE_BODY_HORIZONTAL_CHROME;
}
