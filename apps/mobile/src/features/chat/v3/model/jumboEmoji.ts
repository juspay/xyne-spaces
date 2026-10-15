import type { MessageRowModel, PreviewSegment } from './chatRow.types';

/** WhatsApp-style: 1–3 emoji-only bodies render large. */
export const JUMBO_EMOJI_MAX_COUNT = 3;

/** Must match `CustomEmoji` jumbo size and `measureRowHeight`. */
export const JUMBO_EMOJI_SIZE_PX = 56;

/**
 * Hermes does not implement `Intl.Segmenter`. Match one user-perceived emoji
 * (ZWJ sequences, flags, keycaps, skin tones) so row measurement cannot throw.
 */
const EMOJI_CLUSTER =
  /(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*(?:\u200D(?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*))*)|(?:[0-9#*]\uFE0F?\u20E3)/gu;

const hasBlockingChrome = (model: MessageRowModel): boolean =>
  model.isDeleted ||
  !!model.mediaPreview ||
  !!model.ticketPreview ||
  !!model.linkPreview ||
  !!model.parentPreview ||
  !!model.forwarded ||
  model.isFlowJson ||
  model.body.collapse.isCollapsible;

const leftoverText = (segments: readonly PreviewSegment[]): string =>
  segments
    .filter(segment => segment.kind !== 'emoji')
    .map(segment => segment.text)
    .join('')
    .replace(/\s+/g, '');

const countUnicodeEmojiOnly = (text: string): number | null => {
  const compact = text.replace(/\s+/g, '');
  if (!compact) {
    return null;
  }
  EMOJI_CLUSTER.lastIndex = 0;
  const clusters = compact.match(EMOJI_CLUSTER);
  if (
    clusters === null ||
    clusters.length === 0 ||
    clusters.length > JUMBO_EMOJI_MAX_COUNT ||
    clusters.join('') !== compact
  ) {
    return null;
  }
  return clusters.length;
};

/** True when the body should paint at jumbo size (and reserve that height). */
export const isJumboEmojiModel = (model: MessageRowModel): boolean => {
  if (hasBlockingChrome(model)) {
    return false;
  }
  const custom = model.body.segments.filter(segment => segment.kind === 'emoji');
  if (custom.length > 0) {
    return custom.length <= JUMBO_EMOJI_MAX_COUNT && leftoverText(model.body.segments).length === 0;
  }
  return countUnicodeEmojiOnly(model.body.plainText) !== null;
};
