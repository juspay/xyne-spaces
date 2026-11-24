import { getChatComposerBottomPadding } from '@/src/features/chat/v2/chatKeyboardConfig';

import {
  TYPING_BAR_DICTATING_WIDTH,
  TYPING_BAR_FIELD_HEIGHT,
  TYPING_BAR_MIC_SIZE,
  TYPING_BAR_PADDING_TOP,
  TYPING_BAR_REPLY_PADDING_Y,
  TYPING_BAR_SEND_SIZE,
  TYPING_BAR_TRAILING_GUTTER,
} from '../constants';

type TypingBarAction = 'mic' | 'send' | 'dictating';

const TYPING_BAR_REPLY_PLACEHOLDER = 'Reply…';

/**
 * What sits at the right of the field. Dictation wins while listening; otherwise
 * anything to send (or an edit in progress, which dictation does not support)
 * shows Send, and an empty field offers the mic.
 */
export function typingBarAction(state: {
  hasContent: boolean;
  isEditing: boolean;
  listening: boolean;
}): TypingBarAction {
  if (state.listening) return 'dictating';
  if (state.hasContent || state.isEditing) return 'send';
  return 'mic';
}

export function trailingInset(action: TypingBarAction): number {
  const width =
    action === 'send'
      ? TYPING_BAR_SEND_SIZE
      : action === 'mic'
        ? TYPING_BAR_MIC_SIZE
        : TYPING_BAR_DICTATING_WIDTH;
  return width + TYPING_BAR_TRAILING_GUTTER;
}

/** The least height the bar occupies, so the list reserves what the bar really needs. */
export function getRoomTypingBarMinimumHeight(
  safeAreaBottom: number,
  includeBottomSafeArea = true,
): number {
  return Math.ceil(
    getChatComposerBottomPadding(safeAreaBottom, includeBottomSafeArea) +
      TYPING_BAR_PADDING_TOP +
      TYPING_BAR_FIELD_HEIGHT,
  );
}

/** Figma "Typing bar · Reply": the thread card's bar has its own padding and no safe area. */
export function getThreadTypingBarMinimumHeight(): number {
  return TYPING_BAR_REPLY_PADDING_Y * 2 + TYPING_BAR_FIELD_HEIGHT;
}

/** The screen's placeholder wins; a thread without one reads "Reply…". */
export function typingBarPlaceholder(
  placeholder: string | undefined,
  threadId: string | undefined,
): string | undefined {
  if (placeholder !== undefined) return placeholder;
  return threadId?.trim() ? TYPING_BAR_REPLY_PLACEHOLDER : undefined;
}

const NBSP = new RegExp(String.fromCharCode(160), 'g');

const normalize = (value: string): string =>
  value.replace(/\r\n?/g, '\n').replace(NBSP, ' ').trim();

/**
 * True when a native text change is the editor echoing the text dictation just
 * wrote, rather than the user typing (which should stop dictation).
 */
export function isDictationEcho(nativeText: string, lastWritten: string | null): boolean {
  if (lastWritten === null) return false;
  return normalize(nativeText) === normalize(lastWritten);
}

/**
 * Dictation can write several times before the editor echoes the first, so
 * every write waits in a queue. An echo matching entry N also settles every
 * older entry (the editor skipped them); text matching none is the user typing.
 * Pure: returns whether it was an echo and the queue that remains.
 */
export function consumeDictationEcho(
  nativeText: string,
  pending: readonly string[],
): { echo: boolean; pending: readonly string[] } {
  const index = pending.findIndex(written => isDictationEcho(nativeText, written));
  if (index === -1) return { echo: false, pending };
  return { echo: true, pending: pending.slice(index + 1) };
}

const MAX_PENDING_WRITES = 8;

/** Queues a dictation write, keeping only the most recent few. */
export function queueDictationWrite(
  pending: readonly string[],
  written: string,
): readonly string[] {
  return [...pending, written].slice(-MAX_PENDING_WRITES);
}
