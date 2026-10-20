import { COMPOSER_INPUT_LINE_HEIGHT } from '@/src/components/input-composer/composer-input-typography';
import { getChatComposerBottomPadding } from '@/src/features/chat/v3/composer/chatKeyboardConfig';

export type TypingBarAction = 'mic' | 'send' | 'dictating';

export const TYPING_BAR_REPLY_PLACEHOLDER = 'Reply…';

/** Width the field reserves for each trailing control, so text never runs under it. */
export const MIC_SIZE = 36;
/** Send fills the 36px pill exactly; anything larger is clipped by it. */
export const SEND_SIZE = 36;
/** The bar's own top padding, the pill's vertical padding and its single line. */
export const BAR_TOP_PADDING = 8;
export const FIELD_PADDING_Y = 9;
export const FIELD_MIN_HEIGHT = FIELD_PADDING_Y * 2 + COMPOSER_INPUT_LINE_HEIGHT;
export const DICTATING_WIDTH = 128;
const TRAILING_GUTTER = 4;

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
  const width = action === 'send' ? SEND_SIZE : action === 'mic' ? MIC_SIZE : DICTATING_WIDTH;
  return width + TRAILING_GUTTER;
}

/** The least height the bar occupies, so the list reserves what the bar really needs. */
export function getRoomTypingBarMinimumHeight(
  safeAreaBottom: number,
  includeBottomSafeArea = true,
): number {
  return Math.ceil(
    getChatComposerBottomPadding(safeAreaBottom, includeBottomSafeArea) +
      BAR_TOP_PADDING +
      FIELD_MIN_HEIGHT,
  );
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
