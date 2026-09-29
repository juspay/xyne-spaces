import type { ActionDefinition } from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';

/**
 * Reads an action's details out of the sentence without a language model: code lists the
 * pieces of the sentence a value could be, and Jev picks one per field ("select, don't
 * generate"). A value is therefore always words the user said, or one of a field's options.
 */

/** Each field's value as said: one piece, or a list for fields that hold several records. */
export type FieldWords = Record<string, string | string[]>;

export interface FieldReading {
  state: JevState;
  questions: Record<string, JevQuestion>;
  /** The values Jev picked, by field. A field Jev found nothing for is left out. */
  read(answers: Record<string, JevAnswer>): FieldWords;
}

/** Words that frame a request rather than carry a value: a value never starts or ends on one. */
const FRAME_WORDS = new Set(
  (
    'a about an add and ask called channel create dm find in know let make me mention message ' +
    'named open ping please post say saying send show tell that to with'
  ).split(' ')
);
/** The longest value, in words, except for the rest of the sentence (see `sentencePieces`). */
export const MAX_VALUE_WORDS = 12;
/** Keep candidate spans bounded: 51 value spans plus the "none" option. */
const MAX_PIECES = 51;
const NONE = 'none';
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Every run of words that could be a value, in the user's own spelling and punctuation. When a
 * long sentence has more than Jev takes, the runs that end the sentence come first (a message
 * or a topic usually does), then the shortest.
 */
export function sentencePieces(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const pieces = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    const last = Math.min(words.length, start + MAX_VALUE_WORDS);
    const ends = Array.from({ length: last - start }, (_, index) => start + index + 1);
    // A long message runs to the end of the sentence: "tell Priya <message>".
    if (start < MAX_VALUE_WORDS && last < words.length) ends.push(words.length);
    for (const end of ends) {
      const run = words.slice(start, end);
      if (isFrame(run[0]) || isFrame(run.at(-1))) continue;
      const piece = run.join(' ').replace(EDGE_PUNCTUATION, '');
      if (piece) pieces.add(piece);
    }
  }
  const endings = [...pieces].filter((piece) => text.replace(EDGE_PUNCTUATION, '').endsWith(piece));
  const rest = [...pieces]
    .filter((piece) => !endings.includes(piece))
    .sort((a, b) => a.length - b.length);
  return [...endings, ...rest].slice(0, MAX_PIECES);
}

/**
 * One Jev question per field of `action`, answered from the pieces of `text`. When the same
 * request also asks about other actions, `key` keeps the question ids apart and `premise` says
 * which action the questions are about.
 */
export function readingFor(
  action: ActionDefinition,
  text: string,
  { key = (field: string) => field, premise = '' } = {}
): FieldReading {
  const pieces = sentencePieces(text);
  const pieceOptions = Object.fromEntries(
    pieces.map((piece, index) => [`p${index}`, `“${piece}”`])
  );
  const questions: Record<string, JevQuestion> = {};
  for (const [id, field] of Object.entries(action.fields)) {
    if (field.kind === 'choice') {
      const options = Object.fromEntries(
        (field.options ?? []).map((option) => [option.id, option.label])
      );
      questions[key(id)] = {
        type: 'choice',
        instructions: `${premise}Which option does \`request\` give for ${field.describe}?`,
        criteria: { ...options, [NONE]: 'The request does not say.' },
      };
    } else if (pieces.length > 0) {
      questions[key(id)] = {
        type: 'choice',
        instructions: `${premise}Which option is exactly ${field.describe}, in the user’s own words?`,
        criteria: { ...pieceOptions, [NONE]: 'The request does not say it.' },
      };
    }
  }

  return {
    state: { request: text },
    questions,
    read(answers) {
      const words: FieldWords = {};
      for (const id of Object.keys(action.fields)) {
        const choice = stated(answers[key(id)]);
        if (!choice) continue;
        const field = action.fields[id];
        const value = field?.kind === 'choice' ? choice : pieces[Number(choice.slice(1))];
        if (!value) continue;
        words[id] = field?.many ? value.split(/\s*,\s*|\s+and\s+/).filter(Boolean) : value;
      }
      // Text fields exclude record names from anywhere in the action, then earlier text fields.
      // This keeps a member out of a channel name and a channel name out of its first message.
      const recordValues = Object.entries(words).flatMap(([id, value]) =>
        ['text', 'choice'].includes(action.fields[id]?.kind ?? '')
          ? []
          : Array.isArray(value)
            ? value
            : [value]
      );
      const earlierTextValues: string[] = [];
      for (const [id, value] of Object.entries(words)) {
        const field = action.fields[id];
        if (field?.kind === 'text' && typeof value === 'string') {
          const trimmed = trimEdges(value, [...recordValues, ...earlierTextValues]);
          if (trimmed) words[id] = trimmed;
          else delete words[id];
        }
        const current = words[id];
        if (field?.kind === 'text' && typeof current === 'string') {
          earlierTextValues.push(current);
        }
      }
      return words;
    },
  };
}

/**
 * The option Jev picked. Overlapping pieces split the probability ("the deploy finished",
 * "deploy finished", …), so the value counts as said when all options together outweigh "none".
 */
function stated(answer: JevAnswer | undefined): string | null {
  if (answer?.type !== 'choice') return null;
  if (answer.choice !== NONE) return answer.choice;
  if ((answer.probabilities[NONE] ?? 1) >= 0.5) return null;
  const [best] = Object.entries(answer.probabilities)
    .filter(([option]) => option !== NONE)
    .sort(([, left], [, right]) => right - left);
  return best?.[0] ?? null;
}

function isFrame(word: string | undefined): boolean {
  return FRAME_WORDS.has((word ?? '').replace(EDGE_PUNCTUATION, '').toLowerCase());
}

/** Removes framing words and other fields' values from both ends of `text`, one at a time. */
function trimEdges(text: string, others: readonly string[]): string {
  let words = text.split(/\s+/);
  const matches = (run: readonly string[], other: string): boolean =>
    run.join(' ').replace(EDGE_PUNCTUATION, '').toLowerCase() === other.toLowerCase();
  const trimOnce = (): boolean => {
    if (isFrame(words[0])) {
      words = words.slice(1);
      return true;
    }
    if (isFrame(words.at(-1))) {
      words = words.slice(0, -1);
      return true;
    }
    for (const other of others) {
      const size = other.split(/\s+/).length;
      if (size > words.length) continue;
      if (matches(words.slice(0, size), other)) {
        words = words.slice(size);
        return true;
      }
      if (matches(words.slice(-size), other)) {
        words = words.slice(0, -size);
        return true;
      }
    }
    return false;
  };
  while (words.length > 0 && trimOnce());
  return words.join(' ').replace(EDGE_PUNCTUATION, '');
}
