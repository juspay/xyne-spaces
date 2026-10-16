import type { ChatRow, MessageRowModel } from './chatRow.types';
import { FILE_ATTACHMENT_HEIGHT_PX } from './buildMedia';
import { LINK_PREVIEW_HEIGHT_PX } from './buildPreviews';
import { isJumboEmojiModel, JUMBO_EMOJI_SIZE_PX } from './jumboEmoji';
import {
  LONG_MESSAGE_LINE_BUFFER,
  LONG_MESSAGE_MAX_COLLAPSED_LINES,
  LONG_MESSAGE_MIN_READABLE_CHARS,
} from './text/longMessageCollapse';
import { TEXT_LINE_HEIGHT } from './text/markdownStyle';
import { INLINE_EMOJI_RESERVED_WIDTH_PX, TEXT_CONTAINER_WIDTH_PX } from './layoutConstants';
import { paintsAsSystemFlow, paintsAsSystemJoin } from './rowType';
import { hasStatusChrome, STATUS_LINE_HEIGHT } from './statusChrome';

export const DATE_ROW_HEIGHT = 36;
export const UNREAD_DIVIDER_HEIGHT = 30;
export const SYSTEM_ROW_HEIGHT = 56;
export const SYSTEM_CHROME_HEIGHT = 52;
export const CALL_ROW_HEIGHT = 112;
export const NON_PARTICIPANT_ROW_HEIGHT = 112;
export const TICKET_ROW_HEIGHT = 228;
export const MEDIA_ROW_HEIGHT = 220;
export const SHORT_MESSAGE_HEIGHT = 72;
export const MESSAGE_CHROME_HEIGHT = 52;
export const MESSAGE_SENDER_HEIGHT = 26;
export const MESSAGE_REPLY_HEIGHT = 34;
export const MESSAGE_TICKET_HEIGHT = 176;
export const INLINE_EMOJI_ROW_HEIGHT = 26;
export const REACTION_ROW_HEIGHT = 24;
export { STATUS_LINE_HEIGHT };
const MAX_HEIGHT = 3200;
const AVG_CHAR_WIDTH = 8.8;

export const estimateCharsPerLine = (widthPx: number): number => {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 34;
  return Math.max(16, Math.round(widthPx / AVG_CHAR_WIDTH));
};

const wrappedLines = (text: string, charsPerLine: number): number =>
  (text ? text.split(/\r?\n/) : []).reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)),
    0,
  );

const extrasHeight = (model: MessageRowModel): number =>
  (model.showSenderName ? MESSAGE_SENDER_HEIGHT : 0) +
  (model.parentPreview?.reservedHeightPx ?? 0) +
  (model.forwarded?.reservedHeightPx ?? 0) +
  ((model.replyPreview?.count ?? 0) > 0 ? MESSAGE_REPLY_HEIGHT : 0) +
  (model.threadReplyCount > 0 ? 34 : 0) +
  (model.linkPreview ? LINK_PREVIEW_HEIGHT_PX : 0) +
  (model.mediaPreview?.reservedHeightPx ?? 0) +
  (model.ticketPreview ? MESSAGE_TICKET_HEIGHT : 0) +
  ((model.reactionPreview?.totalCount ?? 0) > 0 ? REACTION_ROW_HEIGHT : 0) +
  (hasStatusChrome(model) ? STATUS_LINE_HEIGHT : 0);

const bodyLineCount = (model: MessageRowModel, rawLines: number, readable: number): number => {
  const threshold = LONG_MESSAGE_MAX_COLLAPSED_LINES + LONG_MESSAGE_LINE_BUFFER;
  if (model.body.collapse.isCollapsible) {
    // +1 is the Read more control. Expanded rows have no collapse control.
    return model.isExpanded ? rawLines : model.body.collapse.collapsedLines + 1;
  }
  if (rawLines >= threshold && readable >= LONG_MESSAGE_MIN_READABLE_CHARS) {
    return LONG_MESSAGE_MAX_COLLAPSED_LINES + 1;
  }
  return rawLines;
};

/**
 * Pure first-pass height estimate used by model tests and diagnostics. Rich
 * message rows are measured by LegendList at runtime; this estimate is not a
 * hard clipping boundary.
 */
export const measureRowHeight = (
  row: ChatRow,
  textContainerWidthPx: number = TEXT_CONTAINER_WIDTH_PX,
): number => {
  if (row.type === 'date') return DATE_ROW_HEIGHT;
  if (row.type === 'unread-divider') return UNREAD_DIVIDER_HEIGHT;
  const model = row.model;
  if (model.callPreview) return CALL_ROW_HEIGHT;
  const charsPerLine = estimateCharsPerLine(textContainerWidthPx);
  const previewText = model.body.segments.length
    ? model.body.segments.map(s => (s.kind === 'emoji' ? '    ' : s.text)).join('')
    : model.body.plainText;
  const normalized = previewText.trim();
  const rawLines = wrappedLines(normalized, charsPerLine);
  if (paintsAsSystemJoin(model) || paintsAsSystemFlow(model)) {
    // SystemMessageRow always paints the complete centered pill. Its body is
    // never replaced by the normal message Read more surface.
    const systemHeight = SYSTEM_CHROME_HEIGHT + rawLines * TEXT_LINE_HEIGHT;
    return Math.max(
      model.nonParticipantPreview ? NON_PARTICIPANT_ROW_HEIGHT : SYSTEM_ROW_HEIGHT,
      systemHeight,
    );
  }
  const extras = extrasHeight(model);
  if (isJumboEmojiModel(model)) {
    const jumbo = MESSAGE_CHROME_HEIGHT + JUMBO_EMOJI_SIZE_PX + 8 + extras;
    return Math.max(SHORT_MESSAGE_HEIGHT, Math.min(MAX_HEIGHT, jumbo));
  }
  const readable = normalized.replace(/\s+/g, ' ').trim().length;
  const estimatedLines = bodyLineCount(model, rawLines, readable);
  const emojiRows =
    model.emojiSlots.length > 0
      ? Math.ceil((model.emojiSlots.length * INLINE_EMOJI_RESERVED_WIDTH_PX) / textContainerWidthPx)
      : 0;
  const textHeight = model.ticketPreview
    ? 0
    : Math.max(estimatedLines * TEXT_LINE_HEIGHT, emojiRows * INLINE_EMOJI_ROW_HEIGHT);
  const height = MESSAGE_CHROME_HEIGHT + textHeight + extras;
  const isFile = model.mediaPreview?.reservedHeightPx === FILE_ATTACHMENT_HEIGHT_PX;
  const minimum =
    model.rowType === 'ticket'
      ? TICKET_ROW_HEIGHT
      : model.rowType === 'media' && !isFile
        ? MEDIA_ROW_HEIGHT
        : SHORT_MESSAGE_HEIGHT;
  return Math.max(minimum, Math.min(MAX_HEIGHT, height));
};
