import type { PaintPreviewSegment } from './chatPaint.types';

const DECORATED_TOKEN_PATTERN =
  /(https?:\/\/[^\s<>()]+|(?:^|[\s([{])[@#][A-Za-z0-9._-][A-Za-z0-9._-]*)/g;
const BROADCAST_MENTION_PATTERN = /^@(channel|here)$/i;

export const buildPlainTextPreviewSegments = (text: string): PaintPreviewSegment[] => {
  if (!text) return [];
  const segments: PaintPreviewSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(DECORATED_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const token = match[0];
    const prefixLength =
      token.startsWith(' ') ||
      token.startsWith('(') ||
      token.startsWith('[') ||
      token.startsWith('{')
        ? 1
        : 0;
    const tokenStart = matchIndex + prefixLength;

    if (tokenStart > cursor) {
      segments.push({ text: text.slice(cursor, tokenStart), kind: 'text' });
    }

    const decoratedToken = text.slice(tokenStart, matchIndex + token.length);
    const kind = token.includes('://') ? 'link' : 'mention';
    segments.push({
      text: decoratedToken,
      kind,
      ...(kind === 'mention' && BROADCAST_MENTION_PATTERN.test(decoratedToken)
        ? { mentionsYou: true }
        : {}),
    });
    cursor = matchIndex + token.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: 'text' });
  }

  return ensureSpacingBetweenAdjacentMentions(
    segments.length > 0 ? segments : [{ text, kind: 'text' }],
  );
};

export const ensureSpacingBetweenAdjacentMentions = (
  segments: readonly PaintPreviewSegment[],
): PaintPreviewSegment[] => {
  const spaced: PaintPreviewSegment[] = [];

  for (const segment of segments) {
    const previous = spaced[spaced.length - 1];
    if (
      previous?.kind === 'mention' &&
      (segment.kind === 'mention' ||
        (segment.kind === 'text' &&
          segment.text.length > 0 &&
          !/^\s|^[.,!?;:)\]}]/.test(segment.text)))
    ) {
      spaced.push({ text: ' ', kind: 'text' });
    }
    spaced.push(segment);
  }

  return spaced;
};
