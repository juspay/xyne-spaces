import type { Message } from '../utils/XyneAITypes';

/**
 * Whether a turn's stored answer (`message.content`) must render after its
 * steps, outside the ordered parts.
 *
 * - A message saved before ordered parts existed has only `content`.
 * - A finished turn whose parts carry no text: the run failed after thinking
 *   or a tool call, and the error paths write their text only to `content`.
 *   Without this the reply ends at the step group and reads as blank.
 *
 * While streaming, text arrives as parts, so nothing falls back.
 */
export function needsFallbackAnswer({
  ordered,
  streaming,
  hasText,
}: {
  ordered: boolean;
  streaming: boolean;
  hasText: boolean;
}): boolean {
  return !ordered || (!streaming && !hasText);
}

/**
 * The reply's content is nothing but the error message that its error card
 * already shows, so rendering it as the answer would print it twice.
 */
export function isErrorOnlyContent(message: Pick<Message, 'content' | 'errorInfo'>): boolean {
  const info = message.errorInfo;
  if (!info) return false;
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  return content === '' || content === info.message.trim();
}
