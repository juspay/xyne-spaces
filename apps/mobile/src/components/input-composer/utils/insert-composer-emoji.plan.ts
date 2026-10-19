import type { EmojiPickerSelection } from '@/src/components/emoji-picker/emoji-picker.types';

import { COMPOSER_INPUT_INLINE_EMOJI_SIZE } from '../composer-input-typography';

const TRAILING_WHITESPACE_REGEX = /\s$/;

/** Native `NSTextAttachment` placeholder. `onChangeText` emits this, not `:name:`. */
export const COMPOSER_NATIVE_IMAGE_CHAR = '\uFFFC';

/**
 * Visible index past any real composer. Native `setSelection` maps this through
 * ZWSP-skipping and clamps to the document end.
 */
export const COMPOSER_NATIVE_DOCUMENT_END = 1_000_000;

export type ComposerCaret = {
  start: number;
  end: number;
};

export type EmojiInsertPlan = {
  currentText: string;
  /** Clamped insert range. Missing caret means "end of `currentText`". */
  caret: ComposerCaret;
  isAppending: boolean;
  /** Leading space — only when appending, to match the native insert path. */
  needsSpace: boolean;
  nextText: string;
  textInsert: string;
};

export function caretFromSelection(
  selection: { start: number; end: number } | null | undefined,
): ComposerCaret | null {
  if (!selection) return null;
  return { start: selection.start, end: selection.end };
}

function clampCaret(currentText: string, caret: ComposerCaret | null | undefined): ComposerCaret {
  if (!caret) {
    const end = currentText.length;
    return { start: end, end };
  }
  const start = Math.max(0, Math.min(caret.start, currentText.length));
  const end = Math.max(start, Math.min(caret.end, currentText.length));
  return { start, end };
}

export function planEmojiInsert(
  currentText: string,
  selection: EmojiPickerSelection,
  caret?: ComposerCaret | null,
): EmojiInsertPlan | null {
  const clamped = clampCaret(currentText, caret);
  const before = currentText.slice(0, clamped.start);
  const after = currentText.slice(clamped.end);
  const isAppending = clamped.start === currentText.length && clamped.end === currentText.length;
  const needsSpace = isAppending && before.length > 0 && !TRAILING_WHITESPACE_REGEX.test(before);

  if (selection.type === 'custom') {
    if (selection.name.trim().length === 0) return null;
    const token = `${needsSpace ? ' ' : ''}${COMPOSER_NATIVE_IMAGE_CHAR}`;
    return {
      currentText,
      caret: clamped,
      isAppending,
      needsSpace,
      nextText: `${before}${token}${after}`,
      textInsert: '',
    };
  }

  const emojiText = selection.value.trim();
  if (emojiText.length === 0) return null;

  const textInsert = `${needsSpace ? ' ' : ''}${emojiText}`;
  return {
    currentText,
    caret: clamped,
    isAppending,
    needsSpace,
    nextText: `${before}${textInsert}${after}`,
    textInsert,
  };
}

export function composerCustomEmojiImgTag(uri: string): string {
  const size = COMPOSER_INPUT_INLINE_EMOJI_SIZE;
  return `<img src="${uri}" width="${size}" height="${size}"/>`;
}

export function composerCustomEmojiInsertMarkup(uri: string, needsSpace: boolean): string {
  return `${needsSpace ? ' ' : ''}${composerCustomEmojiImgTag(uri)}`;
}
