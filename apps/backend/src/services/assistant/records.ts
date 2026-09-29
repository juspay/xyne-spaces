import type { Candidate, EntityKind, EntityRef } from '@xyne/shared/assistant';

/**
 * Matches a spoken name to real records. The lookup itself is an adapter (see adapters.ts):
 * it runs inside the request, so the app's own rules decide what the user may see.
 */

/** A record that could match, with a line that helps distinguish people and app users. */
export interface FoundRecord {
  record: EntityRef;
  detail?: string;
}

/** People and channels named with a search ("with Meera", "in security"), which narrow it. */
export interface SearchHints {
  people: string[];
  channels: string[];
}

export interface RecordFinder {
  /** Records that could match `mention`: names for `matchName` to rank, or search results. */
  find(kind: EntityKind, mention: string, hints?: SearchHints): Promise<FoundRecord[]>;
  /** One record by id, if the user can see it. */
  get(kind: EntityKind, id: string): Promise<FoundRecord | null>;
}

/** A finder's source is down: say so, rather than "I couldn't find it". */
export class UnavailableError extends Error {}

/** Words that point at what is on screen: the open channel or thread, or the selected message. */
const ON_SCREEN_WORDS = new Set(
  'here|this|that|it|this one|this channel|this conversation|this chat|this thread|that thread|this message|that message'.split(
    '|'
  )
);

/**
 * The same finder, where "here", "this thread", or "this message" mean the record of that kind
 * on screen. It is read again by id, so the user's access applies; the screen only lends its
 * display name, such as a message's preview.
 */
export function withScreen(finder: RecordFinder, onScreen: readonly EntityRef[]): RecordFinder {
  return {
    ...finder,
    async find(kind, mention, hints) {
      const shown = isOnScreen(mention) ? onScreen.find((ref) => ref.kind === kind) : undefined;
      if (!shown) return finder.find(kind, mention, hints);
      const found = await finder.get(kind, shown.id);
      if (!found) return [];
      return [{ ...found, record: { ...found.record, name: shown.name || found.record.name } }];
    },
  };
}

/**
 * How a mention picks among what was found: search results and "here" are ranked already,
 * so the first is the answer and several are a choice; names are ranked by `matchName`.
 */
export function matchFound(
  kind: EntityKind,
  mention: string,
  found: readonly FoundRecord[]
): NameMatch {
  const byName = (kind === 'person' || kind === 'channel') && !isOnScreen(mention);
  if (byName) return matchName(mention, found);
  const [first] = found;
  if (!first) return { kind: 'none' };
  if (found.length === 1) return { kind: 'one', record: first.record, certain: false };
  return { kind: 'several', candidates: found.map(toCandidate) };
}

/** "here", "this", "this message": words that point at the screen rather than name something. */
export function isOnScreen(mention: string): boolean {
  return ON_SCREEN_WORDS.has(normalizeName(mention));
}

export type NameMatch =
  /** One clear record. `certain` when the name matched exactly, not just partly. */
  | { kind: 'one'; record: EntityRef; certain: boolean }
  /** Equally good matches; the user picks one. */
  | { kind: 'several'; candidates: Candidate[] }
  | { kind: 'none' };

/** Most records a "which one?" question offers. */
const MAX_CANDIDATES = 5;

/**
 * Ranks records against what the user said: the full name beats a first name or a whole
 * word, which beats part of a name, which beats a name that only sounds the same. The
 * best-ranked records win; a tie is a question. Only the full name is certain; anything less
 * is confirmed with the user before it is used.
 */
export function matchName(mention: string, found: readonly FoundRecord[]): NameMatch {
  const said = normalizeName(mention);
  if (!said) return { kind: 'none' };
  const scored = found
    .map(({ record, detail }) => ({
      record,
      detail,
      score: nameScore(said, normalizeName(record.name)),
    }))
    .filter(({ score }) => score > 0);
  const best = Math.max(0, ...scored.map(({ score }) => score));
  const top = scored.filter(({ score }) => score === best);
  const [only] = top;
  if (!only) return { kind: 'none' };
  if (top.length === 1) return { kind: 'one', record: only.record, certain: best >= EXACT };
  return { kind: 'several', candidates: top.slice(0, MAX_CANDIDATES).map(toCandidate) };
}

function toCandidate({ record, detail }: FoundRecord): Candidate {
  return { id: record.id, label: record.name, ...(detail ? { detail } : {}), value: record };
}

/** The full name as said. */
const EXACT = 3;
/** Whole words of the name, such as a first name. */
const WORDS = 2;
/** Part of the name. */
const PART = 1;
/** Sounds like words of the name, as speech-to-text spells it ("Priti" for "Preeti"). */
const SOUNDS_LIKE = 0.5;

function nameScore(said: string, name: string): number {
  if (said === name) return EXACT;
  const nameWords = name.split(' ');
  const saidWords = said.split(' ');
  const exactWords = saidWords.filter((word) => nameWords.includes(word)).length;
  if (exactWords === saidWords.length) return WORDS;
  const allWordsSoundLike = saidWords.every((word) =>
    nameWords.some((nameWord) => soundsAlike(soundKey(word), soundKey(nameWord)))
  );
  if (allWordsSoundLike) return WORDS + exactWords / (saidWords.length + 1);
  if (name.includes(said)) return PART;
  // Speech recognition can get one name wrong while retaining a useful surname or role
  // word ("Zahn Doctor" for "Xyne Doctor"). Offer this only as an uncertain match.
  if (saidWords.some((word) => nameWords.includes(word))) return PART;
  const nameSounds = nameWords.map(soundKey);
  return saidWords.every((word) => nameSounds.some((sound) => soundsAlike(soundKey(word), sound)))
    ? SOUNDS_LIKE
    : 0;
}

/**
 * Spellings that sound the same, made equal. Chosen for names as speech-to-text spells them,
 * Indian names included, which English-only codes such as Soundex handle badly.
 */
const SOUND_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^x(?=[aeiouy])/, 'z'], // X is often spoken as Z at the start of names (Xyne/Zyne).
  [/ph/g, 'f'],
  [/([bdgkst])h/g, '$1'], // bh, dh, gh, kh, sh, th
  [/ee|ea|ie/g, 'i'],
  [/oo|ou/g, 'u'],
  [/w/g, 'v'],
  [/z/g, 'j'],
  [/(.)\1+/g, '$1'], // doubled letters
  [/[ah]$/, ''], // a trailing a or h is often not heard
];

/** "Preeti" and "Priti" both sound like "priti". */
export function soundKey(word: string): string {
  return SOUND_RULES.reduce(
    (key, [pattern, replacement]) => key.replace(pattern, replacement),
    word
  );
}

/** One letter apart is still alike for longer names, never for short ones like "priy". */
function soundsAlike(said: string, name: string): boolean {
  if (said === name) return true;
  return Math.min(said.length, name.length) >= 5 && editDistance(said, name) <= 1;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** "Release-Planning" and "release planning" are the same name. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
