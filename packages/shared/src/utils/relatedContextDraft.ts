/**
 * When a chat composer draft is worth a related-context lookup, and how much of it is
 * used. One definition for the composer, which sends nothing else, and for the server,
 * which checks again — so the two can't drift apart.
 */

/** Words a draft needs: shorter ones are acknowledgements and names, not questions. */
export const RELATED_CONTEXT_MIN_WORDS = 4;

/** The part of a draft that is used; the rest is cut before it is sent or searched. */
export const RELATED_CONTEXT_MAX_DRAFT_CHARS = 600;

/** Whitespace collapsed, ends trimmed, cut to the part that is used. */
export const normalizeRelatedDraft = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').slice(0, RELATED_CONTEXT_MAX_DRAFT_CHARS);

/**
 * Whether a normalized draft is worth looking up: not a slash command, and at least
 * RELATED_CONTEXT_MIN_WORDS words once links and @mentions are left out, a word being
 * anything with two letters or more.
 */
export const isRelatedDraftWorthLookingUp = (draft: string): boolean => {
  if (draft.startsWith('/')) return false;
  const words = draft
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter(word => /\p{L}{2,}/u.test(word) && !word.startsWith('@'));
  return words.length >= RELATED_CONTEXT_MIN_WORDS;
};
