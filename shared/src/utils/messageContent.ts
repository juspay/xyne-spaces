/**
 * Shared message-content length helpers.
 *
 * Used by both the client composer and the backend message repository so the
 * limit is enforced with the *same* measurement on each side. The functions
 * operate on the raw HTML string that both layers already handle (the editor
 * value on the client, the persisted `content` on the server) and approximate
 * the visible character count a user sees.
 *
 * Implementation is intentionally isomorphic — no `DOMParser` (browser-only)
 * and no `html-to-text` (Node-only) — so the count is identical across the
 * dashboard (browser), backend (Node), and lotus (React Native).
 */

export const MAX_MESSAGE_CONTENT_LENGTH = 10000;

/**
 * Approximate the visible (rendered) character length of an HTML message body.
 * Strips tags and decodes the most common entities, treating block boundaries
 * and `<br>` as a single space so adjacent blocks don't merge into one word.
 */
export function getMessageContentLength(html: string): number {
  if (!html) return 0;

  const text = html
    // Drop script/style contents entirely.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Treat <br> and block-closing tags as a whitespace boundary.
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    // Strip all remaining tags.
    .replace(/<[^>]+>/g, '')
    // Decode the most common HTML entities to their single visible character.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    .trim();

  return text.length;
}

/**
 * Returns a user-facing error message when the content exceeds the limit, or
 * `undefined` when it's within bounds. Suitable directly as a form validator;
 * the backend can throw when a message is returned.
 */
export function validateMessageContentLength(
  html: string,
  maxLength: number = MAX_MESSAGE_CONTENT_LENGTH,
): string | undefined {
  if (getMessageContentLength(html) > maxLength) {
    return `Message must be ${maxLength} characters or less`;
  }
  return undefined;
}
