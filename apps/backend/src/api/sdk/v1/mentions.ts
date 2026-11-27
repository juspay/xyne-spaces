/**
 * Mention shorthand (`@Name[userId]`, `@Alias[group:…]`, `@channel`, `@here`) in message
 * content, expanded to the span the composer writes so the message notifies. An API caller
 * cannot be expected to hand-write that span, so v1 expands it here, before the mutator
 * runs. The patterns and markup live in `@xyne/shared` (expandMentionShorthand), shared
 * with the clients that expand a field themselves before encrypting it.
 */

import { expandMentionShorthand, isEncryptedField } from '@xyne/shared';

/**
 * Expand mention shorthand in `content`. Non-strings pass through for the mutator's schema to
 * judge, and so does ciphertext: a field the client encrypted by a manifest rule arrives
 * already expanded (the client expands it before encrypting), and its text is not ours to read.
 */
export function expandMentions<T>(content: T): T {
  if (typeof content !== 'string' || isEncryptedField(content as unknown)) return content;
  return expandMentionShorthand(content) as T;
}
