import { hasValue, type ActionDefinition } from '../actions/action';
import { nameWordsOf, withoutLead } from './quickReplies';
import type { Resolution } from './resolve';

const PUNCTUATION = /^[\s,.:;!?–—-]+/;
const ARTICLES = new Set(['a', 'an', 'the']);
// What trails a place or a name without being a message: "in the design channel", "to Priya please".
const TRAILING = new Set(
  'channel thread chat group dm conversation here please pls now too the this that'.split(' '),
);

const wordOf = (word: string): string => word.toLowerCase().replace(/[^a-z']/g, '');

// After the run of words that ask for the action: "Message, can we…" is "can we…".
function afterRequest(said: string, action: ActionDefinition): string {
  const names = nameWordsOf(action);
  const words = withoutLead(said).split(/\s+/);
  const asked = words.findIndex(word => {
    const plain = wordOf(word).replace(/s$/, '');
    return !names.has(plain) && !ARTICLES.has(plain);
  });
  return asked > 0 ? words.slice(asked).join(' ') : '';
}

// After the last value read from the sentence: "…mentioning Sarah, can you do RCA?". Null when
// none of them is in it.
function afterValues(said: string, values: readonly string[]): string | null {
  const lower = said.toLowerCase();
  const ends = values.map(value => {
    const at = lower.lastIndexOf(value.trim().toLowerCase());
    return at < 0 ? -1 : at + value.trim().length;
  });
  const end = Math.max(-1, ...ends);
  return end < 0 ? null : said.slice(end);
}

// The last of several sentences: "No message mentioning Sara. Can you do RC?".
const lastSentence = (said: string): string => {
  const sentences = said.trim().split(/(?<=[.?!])\s+/);
  return sentences.length > 1 ? (sentences.at(-1) ?? '') : '';
};

const asMessage = (rest: string): string | null => {
  const message = rest.replace(PUNCTUATION, '').trim();
  const words = message.split(/\s+/).map(wordOf);
  return words.some(word => word && !TRAILING.has(word)) ? message : null;
};

/**
 * The message as said, when Jev read none: the words after the other values, or after the
 * request, or else the last of several sentences.
 */
export function messageSaid(
  said: string,
  action: ActionDefinition,
  values: Record<string, string>,
): string | null {
  const after = afterValues(said, Object.values(values).filter(hasValue));
  if (after !== null) return asMessage(after);
  return asMessage(afterRequest(said, action)) ?? asMessage(lastSentence(said));
}

// The words after a person field's own label, when that is a word of its own ("mentioning Sara").
const LABEL_WORD = /^[a-z]{4,}$/;

/** People said right after their field's label, found exactly: for when Jev read none. */
export function peopleByLabel(
  said: string,
  action: ActionDefinition,
  values: Record<string, string>,
  find: (field: string, words: string) => Resolution | null,
): Record<string, { words: string; found: Resolution }> {
  const words = said.trim().split(/\s+/);
  const read: Record<string, { words: string; found: Resolution }> = {};
  for (const [field, { kind, label }] of Object.entries(action.fields)) {
    if (kind !== 'person' || hasValue(values[field]) || !LABEL_WORD.test(label)) continue;
    const at = words.findIndex(word => wordOf(word) === label);
    if (at < 0) continue;
    for (let count = 3; count > 0; count -= 1) {
      const name = words
        .slice(at + 1, at + 1 + count)
        .join(' ')
        .replace(/[,.:;!?]+$/, '');
      const found = name.split(' ').length === count ? find(field, name) : null;
      if (found?.kind === 'one') {
        read[field] = { words: name, found };
        break;
      }
    }
  }
  return read;
}

// At most one letter apart: "Sarah" for "Sara".
const near = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  for (let at = 0; at < long.length; at += 1) {
    if (short[at] === long[at]) continue;
    const skip = short.length === long.length ? 1 : 0;
    return short.slice(at + skip) === long.slice(at + 1);
  }
  return true;
};

/** The message without a person's name it starts with, as said or found: that is the mention. */
export function withoutLeadingName(
  message: string,
  people: readonly { said: string; found?: Resolution | undefined }[],
): string {
  const names = people.flatMap(({ said, found }) => [
    said,
    ...(found?.kind === 'one' ? [found.pick.label.replace(/\s*\(.*\)$/, '')] : []),
  ]);
  const words = message.trim().split(/\s+/);
  const spoken = (count: number): string => words.slice(0, count).map(wordOf).join(' ');
  for (const name of names) {
    const parts = name.trim().split(/\s+/).map(wordOf);
    const full = parts.length > 1 && spoken(parts.length) === parts.join(' ');
    const first = !full && parts[0] && near(spoken(1), parts[0]);
    if (!full && !first) continue;
    const rest = words.slice(full ? parts.length : 1).join(' ');
    return rest.replace(PUNCTUATION, '').trim() || message;
  }
  return message;
}
