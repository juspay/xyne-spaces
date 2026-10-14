import {
  LONG_MESSAGE_LINE_BUFFER,
  LONG_MESSAGE_MAX_COLLAPSED_LINES,
  LONG_MESSAGE_MIN_READABLE_CHARS,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';
import {
  ATTACHMENT_GRID_HEIGHT,
  FILE_ATTACHMENT_CARD_HEIGHT,
} from '@/src/features/chat/v2/components/conversation-composer/attachment-layout';

import type {
  ChatPaintCollapseModel,
  ChatPaintEmojiSlot,
  ChatPaintMediaGeometry,
  ChatPaintParentPreview,
  ChatPaintRow,
  ChatPaintRowType,
  PaintPreviewSegment,
} from './chatPaint.types';

const DATE_ROW_ESTIMATED_HEIGHT = 36;
// Fixed height for the standalone "New messages" unread divider row (px-4 pb-1 pt-2 + ~16px label).
const UNREAD_DIVIDER_ROW_HEIGHT = 30;
const SYSTEM_ROW_ESTIMATED_HEIGHT = 56;
const SYSTEM_ROW_VERTICAL_CHROME_HEIGHT = 52;
export const SPECIAL_SYSTEM_ROW_ESTIMATED_HEIGHT = 112;
const TICKET_ROW_ESTIMATED_HEIGHT = 228;
const MEDIA_ROW_ESTIMATED_HEIGHT = 220;
// LegendList v3 accepts one initial allocation hint for dynamic rows. The most common
// chat row is a short text message, whose minimum rendered estimate is 72px.
export const CHAT_LIST_INITIAL_ITEM_SIZE = 72;
const SHORT_MESSAGE_ESTIMATED_HEIGHT = CHAT_LIST_INITIAL_ITEM_SIZE;
const TEXT_LINE_HEIGHT = 20;
const MESSAGE_CHARS_PER_LINE = 34;
// Average glyph advance for the body font, calibrated so the default text-container
// width (CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX = 300) yields ~MESSAGE_CHARS_PER_LINE.
// 300 / 34 ≈ 8.8.
const AVG_BODY_CHAR_WIDTH_PX = 8.8;

/**
 * Chars-per-line for the wrap estimate, derived from the *actual* text-container
 * width so the initial-scroll offset estimate stays accurate across device widths
 * (a fixed 34 over/under-shoots on narrow/wide screens and parks the list off-screen
 * → "blank until you scroll"). Falls back to the default for unspecified callers.
 */
export const estimateCharsPerLine = (textContainerWidthPx: number): number => {
  if (!Number.isFinite(textContainerWidthPx) || textContainerWidthPx <= 0) {
    return MESSAGE_CHARS_PER_LINE;
  }
  return Math.max(16, Math.round(textContainerWidthPx / AVG_BODY_CHAR_WIDTH_PX));
};
const MESSAGE_VERTICAL_CHROME_HEIGHT = 52;
const MESSAGE_SENDER_HEIGHT = 26;
const MESSAGE_REPLY_HEIGHT = 34;
const MESSAGE_TICKET_HEIGHT = 176;
const MESSAGE_LINK_PREVIEW_HEIGHT = 86;
const MESSAGE_RECORDING_PREVIEW_HEIGHT = 64;
const INLINE_EMOJI_ROW_HEIGHT = 26;
const REACTION_ROW_HEIGHT = 24;
const MAX_MESSAGE_ESTIMATED_HEIGHT = 3200;

export const CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX = 300;
/** Matches `px-2` horizontal padding on `chat-composer.tsx` bubble inner shell. */
export const CHAT_BUBBLE_HORIZONTAL_PADDING_PX = 16;
export const CHAT_PAINT_COLLAPSE_VIEWPORT_HEIGHT_PX = 760;
export const CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX = 24;
export const CHAT_PAINT_MEDIA_BOTTOM_SPACING_PX = 10;
export const CHAT_PAINT_MEDIA_GRID_HEIGHT_PX =
  ATTACHMENT_GRID_HEIGHT + CHAT_PAINT_MEDIA_BOTTOM_SPACING_PX;
export const CHAT_PAINT_FILE_ATTACHMENT_HEIGHT_PX =
  FILE_ATTACHMENT_CARD_HEIGHT + CHAT_PAINT_MEDIA_BOTTOM_SPACING_PX;
export const CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX = 82;
export const CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO = 4 / 3;
export const CHAT_PAINT_REACTION_SLOT_HEIGHT_PX = REACTION_ROW_HEIGHT;

export const getDateRowEstimatedHeight = (): number => DATE_ROW_ESTIMATED_HEIGHT;
export const getUnreadDividerRowHeight = (): number => UNREAD_DIVIDER_ROW_HEIGHT;

const getTextForLineEstimate = (
  previewText: string,
  previewSegments?: PaintPreviewSegment[] | undefined,
): string => {
  if (!previewSegments || previewSegments.length === 0) return previewText;
  return previewSegments
    .map(segment => (segment.kind === 'emoji' ? ' '.repeat(4) : segment.text))
    .join('');
};

const estimateWrappedLineCount = (
  text: string,
  charsPerLine: number = MESSAGE_CHARS_PER_LINE,
): number => {
  const perLine = charsPerLine > 0 ? charsPerLine : MESSAGE_CHARS_PER_LINE;
  const explicitLines = text ? text.split(/\r?\n/) : [];
  return explicitLines.reduce((total, line) => {
    const visualLineCount = Math.max(1, Math.ceil(line.length / perLine));
    return total + visualLineCount;
  }, 0);
};

export const estimateChatPaintRowHeight = ({
  previewText,
  previewSegments,
  rowType,
  showSenderName = false,
  replyCount = 0,
  hasTicketPreview = rowType === 'ticket',
  hasLinkPreview = false,
  hasRecordingPreview = false,
  hasMediaPlaceholder = rowType === 'media',
  hasParentPreview = false,
  emojiSlots = [],
  media,
  replyAvatarSlots,
  parentPreview,
  collapse,
  reactionSummaryCount = 0,
  charsPerLine = MESSAGE_CHARS_PER_LINE,
}: {
  previewText: string;
  previewSegments?: PaintPreviewSegment[] | undefined;
  rowType: ChatPaintRowType;
  showSenderName?: boolean;
  replyCount?: number;
  hasTicketPreview?: boolean;
  hasLinkPreview?: boolean;
  hasRecordingPreview?: boolean;
  hasMediaPlaceholder?: boolean;
  hasParentPreview?: boolean;
  emojiSlots?: readonly ChatPaintEmojiSlot[] | undefined;
  media?: ChatPaintMediaGeometry | undefined;
  replyAvatarSlots?: number | undefined;
  parentPreview?: ChatPaintParentPreview | undefined;
  collapse?: ChatPaintCollapseModel | undefined;
  reactionSummaryCount?: number | undefined;
  charsPerLine?: number | undefined;
}): number => {
  const normalizedText = getTextForLineEstimate(previewText, previewSegments).trim();
  const rawEstimatedTextLines = estimateWrappedLineCount(normalizedText, charsPerLine);
  if (rowType === 'system') {
    return Math.max(
      SYSTEM_ROW_ESTIMATED_HEIGHT,
      SYSTEM_ROW_VERTICAL_CHROME_HEIGHT + rawEstimatedTextLines * TEXT_LINE_HEIGHT,
    );
  }

  const readableCharacterCount = normalizedText.replace(/\s+/g, ' ').trim().length;
  const collapseThreshold = LONG_MESSAGE_MAX_COLLAPSED_LINES + LONG_MESSAGE_LINE_BUFFER;
  const hasExplicitCollapseModel = collapse !== undefined;
  const estimatedTextLines =
    collapse?.isCollapsible === true
      ? collapse.collapsedLines + 1
      : hasExplicitCollapseModel
        ? rawEstimatedTextLines
        : rawEstimatedTextLines >= collapseThreshold &&
            readableCharacterCount >= LONG_MESSAGE_MIN_READABLE_CHARS
          ? LONG_MESSAGE_MAX_COLLAPSED_LINES + 1
          : rawEstimatedTextLines;
  const emojiReservedRows =
    emojiSlots.length > 0
      ? Math.ceil(
          (emojiSlots.length * CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX) /
            CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX,
        )
      : 0;
  const textBlockHeight = hasTicketPreview
    ? 0
    : Math.max(estimatedTextLines * TEXT_LINE_HEIGHT, emojiReservedRows * INLINE_EMOJI_ROW_HEIGHT);

  const estimatedHeight =
    MESSAGE_VERTICAL_CHROME_HEIGHT +
    textBlockHeight +
    (showSenderName ? MESSAGE_SENDER_HEIGHT : 0) +
    (parentPreview?.reservedHeightPx ??
      (hasParentPreview ? CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX : 0)) +
    ((replyAvatarSlots ?? 0) > 0 || replyCount > 0 ? MESSAGE_REPLY_HEIGHT : 0) +
    (hasLinkPreview ? MESSAGE_LINK_PREVIEW_HEIGHT : 0) +
    (hasRecordingPreview ? MESSAGE_RECORDING_PREVIEW_HEIGHT : 0) +
    (media?.reservedHeightPx ?? (hasMediaPlaceholder ? CHAT_PAINT_MEDIA_GRID_HEIGHT_PX : 0)) +
    (hasTicketPreview ? MESSAGE_TICKET_HEIGHT : 0) +
    (reactionSummaryCount > 0 ? CHAT_PAINT_REACTION_SLOT_HEIGHT_PX : 0);

  const isFileAttachmentRow = media?.reservedHeightPx === CHAT_PAINT_FILE_ATTACHMENT_HEIGHT_PX;
  const minimumHeight =
    rowType === 'ticket'
      ? TICKET_ROW_ESTIMATED_HEIGHT
      : rowType === 'media' && !isFileAttachmentRow
        ? MEDIA_ROW_ESTIMATED_HEIGHT
        : SHORT_MESSAGE_ESTIMATED_HEIGHT;

  return Math.max(minimumHeight, Math.min(MAX_MESSAGE_ESTIMATED_HEIGHT, estimatedHeight));
};

// Per-row estimate is regex/string-split heavy and is called O(n) over the whole
// list on open (initial-end-offset reduce) plus row measurement/cache warmup.
// Cache by row object identity: paint rows are immutable and only rebuilt when content
// changes, so a WeakMap hit is always correct (and a content change yields a fresh row
// object → fresh compute). This is identity-safe even though contentSignature alone
// would miss grouping state like showSenderName.
let rowHeightEstimateCache = new WeakMap<ChatPaintRow, number>();
let rowHeightEstimateCacheCharsPerLine = MESSAGE_CHARS_PER_LINE;

export const getChatRowEstimatedHeight = (
  row: ChatPaintRow,
  charsPerLine: number = MESSAGE_CHARS_PER_LINE,
): number => {
  // The cache is identity-keyed; a charsPerLine change (orientation / different device
  // width) invalidates it wholesale since every estimate then differs.
  if (charsPerLine !== rowHeightEstimateCacheCharsPerLine) {
    rowHeightEstimateCache = new WeakMap<ChatPaintRow, number>();
    rowHeightEstimateCacheCharsPerLine = charsPerLine;
  }
  const cached = rowHeightEstimateCache.get(row);
  if (cached !== undefined) return cached;
  const height = estimateChatPaintRowHeight({
    previewText: row.body?.plainText ?? row.plainPreviewText,
    previewSegments: row.body?.segments ?? row.previewSegments,
    rowType: row.rowType,
    showSenderName: row.showSenderName,
    replyCount: row.replyPreview?.count ?? row.replyCount,
    hasTicketPreview: !!row.ticketPreview,
    hasLinkPreview: !!row.linkPreview,
    hasRecordingPreview: !!row.recordingPreview,
    hasMediaPlaceholder: !!row.mediaPlaceholder,
    hasParentPreview: !!row.parentPreviewText,
    emojiSlots: row.emojiSlots,
    media: row.media,
    replyAvatarSlots: row.replyPreview?.latestReplierIds?.length ?? row.replyAvatarSlots,
    parentPreview: row.parentPreview,
    collapse: row.body?.collapse ?? row.collapse,
    reactionSummaryCount: row.reactionPreview?.totalCount ?? row.reactionSummaryCount,
    charsPerLine,
  });
  const resolvedHeight =
    row.rowType === 'system' && row.estimatedHeight > 0
      ? Math.max(row.estimatedHeight, height)
      : height;
  rowHeightEstimateCache.set(row, resolvedHeight);
  return resolvedHeight;
};
