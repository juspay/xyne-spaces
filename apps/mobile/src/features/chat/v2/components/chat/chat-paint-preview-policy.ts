import type { ChatPaintBody, PaintPreviewSegment } from '../../paint/chatPaint.types';

export type ChatPaintPreviewMode = 'plain' | 'inline-rich' | 'interactive-segments' | 'emoji';

type ChatPaintPreviewInput = Pick<ChatPaintBody, 'inlineMarkdown' | 'plainText' | 'segments'>;

export const getChatPaintPreviewMode = ({
  inlineMarkdown,
  plainText,
  segments,
}: ChatPaintPreviewInput): ChatPaintPreviewMode => {
  let hasInteractiveSegment = false;

  for (const segment of segments) {
    if (segment.kind === 'emoji') return 'emoji';
    if (segment.kind === 'link' || segment.kind === 'mention') {
      hasInteractiveSegment = true;
    }
  }

  const normalizedMarkdown = inlineMarkdown?.trim();
  const needsInlineFormatting = !!normalizedMarkdown && normalizedMarkdown !== plainText.trim();

  if (normalizedMarkdown && (hasInteractiveSegment || needsInlineFormatting)) {
    return 'inline-rich';
  }
  if (hasInteractiveSegment) return 'interactive-segments';
  return 'plain';
};

/**
 * Keep the paint-preview row mounted when swapping to ChatComposer would
 * remount native markdown / emoji images (Read more expand, emoji+text).
 * Forwarded and Flow-JSON still promote because they need the rich shell.
 */
export const shouldKeepChatPaintPreview = ({
  isCollapsible,
  isForwardedMessage,
  isFlowJsonMessage,
  customEmojiCount,
  hasMediaPlaceholder,
}: {
  isCollapsible: boolean;
  isForwardedMessage: boolean;
  isFlowJsonMessage: boolean;
  customEmojiCount: number;
  hasMediaPlaceholder: boolean;
}): boolean => {
  if (isForwardedMessage || isFlowJsonMessage) return false;
  if (isCollapsible) return true;
  return customEmojiCount > 0 && !hasMediaPlaceholder;
};

/**
 * Split preview runs on explicit newlines so emoji+text can render each chat
 * line as its own flex row (avoids leftover-width indent after an emoji).
 */
export const groupPaintPreviewSegmentsByLine = (
  segments: PaintPreviewSegment[],
): PaintPreviewSegment[][] => {
  const lines: PaintPreviewSegment[][] = [];
  let current: PaintPreviewSegment[] = [];

  const pushLine = (): void => {
    lines.push(current);
    current = [];
  };

  for (const segment of segments) {
    if (segment.kind === 'emoji') {
      current.push(segment);
      continue;
    }

    const parts = segment.text.replace(/\r\n/g, '\n').split('\n');
    parts.forEach((part, index) => {
      if (index > 0) pushLine();
      if (part.length > 0) {
        current.push({ ...segment, text: part });
      }
    });
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }

  return lines;
};

export type ChatPaintPreviewSegment = PaintPreviewSegment;
