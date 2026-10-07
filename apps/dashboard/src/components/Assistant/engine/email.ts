import { EMAIL_PATTERN } from '../../../utils/emailAddress';
import type { Resolution } from './resolve';

/**
 * The email addresses in what the user typed or said. Typed: "Vinit@juspay.in." Said, as speech
 * to text gives it: "vinit dot khandal at juspay dot in", "v i n i t at the rate juspay dot in".
 * Pure, and lowercased, as the server stores an invitee's address.
 */

const SEPARATORS: Readonly<Record<string, string>> = {
  dot: '.',
  period: '.',
  point: '.',
  underscore: '_',
  dash: '-',
  hyphen: '-',
};
const AT = '@';
// Punctuation speech to text puts around words, and a typed address may end on.
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TYPED = /[^\s@,;:<>()"']+@[^\s@,;:<>()"']+/g;

const isSeparator = (word: string | undefined): boolean => !!word && word in SEPARATORS;
// Letters spelled out one by one ("v i n i t"), or a digit, are joined into one word.
const isSpelled = (word: string | undefined): boolean => !!word && /^[\p{L}\p{N}]$/u.test(word);

// "at the rate (of)" and a lone "at" both stand for @.
function wordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map(word => (word.includes(AT) ? word : word.replace(EDGE, '')))
    .filter(Boolean);
  const out: string[] = [];
  for (let at = 0; at < words.length; at += 1) {
    if (words[at] === 'at' && words[at + 1] === 'the' && words[at + 2] === 'rate') {
      out.push(AT);
      at += words[at + 3] === 'of' ? 3 : 2;
    } else {
      out.push(words[at] === 'at' ? AT : (words[at] ?? ''));
    }
  }
  return out;
}

// The part before @, read backwards from it: words joined by "dot", "underscore" or "dash", and
// letters spelled out. It stops at the first word not joined to the next: "invite vinit" is vinit.
function localPart(words: readonly string[], at: number): string {
  let local = '';
  let index = at - 1;
  for (;;) {
    const word = words[index];
    if (!word || word === AT || isSeparator(word)) return local;
    if (isSpelled(word)) {
      let spelled = '';
      while (isSpelled(words[index])) {
        spelled = `${words[index] ?? ''}${spelled}`;
        index -= 1;
      }
      local = `${spelled}${local}`;
    } else {
      local = `${word}${local}`;
      index -= 1;
    }
    const joiner = words[index];
    if (!isSeparator(joiner) || !words[index - 1] || isSeparator(words[index - 1])) return local;
    local = `${SEPARATORS[joiner ?? ''] ?? ''}${local}`;
    index -= 1;
  }
}

// The part after @: a word, then "dot" and a word as often as they come.
function domainPart(words: readonly string[], at: number): string {
  let index = at + 1;
  const take = (): string => {
    let word = '';
    if (isSpelled(words[index])) {
      while (isSpelled(words[index])) word += words[(index += 1) - 1] ?? '';
    } else if (words[index] && words[index] !== AT && !isSeparator(words[index])) {
      word = words[(index += 1) - 1] ?? '';
    }
    return word;
  };
  let domain = take();
  while (domain && SEPARATORS[words[index] ?? ''] === '.') {
    index += 1;
    const next = take();
    if (!next) break;
    domain = `${domain}.${next}`;
  }
  return domain;
}

export const isEmail = (text: string): boolean => EMAIL_PATTERN.test(text);

/** Every address in the text, the typed ones first, then those said; once each. */
export function emailsIn(text: string): string[] {
  const typed = (text.match(TYPED) ?? []).map(found => found.replace(EDGE, '').toLowerCase());
  const words = wordsOf(text);
  const spoken = words.flatMap((word, at) =>
    word === AT ? [`${localPart(words, at)}@${domainPart(words, at)}`] : [],
  );
  return [...new Set([...typed, ...spoken])].filter(isEmail);
}

/**
 * The address the words are, as a field that reads one takes them: one is picked, several are
 * chosen from, and none is asked for again.
 */
export function emailResolution(words: string): Resolution {
  const found = emailsIn(words).map(email => ({ id: email, label: email }));
  const [only] = found;
  if (!only) return { kind: 'none' };
  return found.length === 1 ? { kind: 'one', pick: only } : { kind: 'many', options: found };
}
