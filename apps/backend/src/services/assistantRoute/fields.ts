import type { JevAnswer, JevQuestion } from '@/services/queryIntent/jevClient';
import type { AssistantRouteFieldKind } from '@/validators/assistantRouteValidator';

/**
 * Reads an action's field values out of the sentence without generating text: code lists the
 * runs of words a value could be, and Jev picks one per field ("select, don't generate"). A
 * value is therefore always words the user said, or one of a choice field's options.
 */

export interface AssistantRouteField {
  describe: string;
  kind: AssistantRouteFieldKind;
  options?: string[];
}

/**
 * When a field's value counts as said. `span`: its best option has at least `floor`. `said`: the
 * sentence is not "none" at that level (1 - p(none)), for a value whose probability splits over
 * spans that overlap.
 */
export interface FieldFloor {
  floor: number;
  by: 'span' | 'said';
}

export interface FieldReading {
  questions: Record<string, JevQuestion>;
  /**
   * The values Jev picked, by field. A field that does not reach `floorFor(field)`, or that Jev
   * found nothing for, is left out. A long value (spans to the end of the sentence) is always
   * judged `said`: its spans overlap, so none gets most of the probability.
   */
  read(
    answers: Record<string, JevAnswer>,
    floorFor: (field: string) => FieldFloor
  ): Record<string, string>;
}

/**
 * How each kind of field is read. `spans`: the user's words for a value ('value': a short run,
 * 'rest': up to the end of the sentence) or one of the field's options. `resolved`: the client
 * turns the words into a record (a person, a channel, a date), so they are left as said.
 */
const KIND_TRAITS: Record<
  AssistantRouteFieldKind,
  { spans: 'value' | 'rest' | 'options'; resolved: boolean; options?: string[] }
> = {
  text: { spans: 'value', resolved: false },
  longtext: { spans: 'rest', resolved: false },
  choice: { spans: 'options', resolved: false },
  boolean: { spans: 'options', resolved: false, options: ['yes', 'no'] },
  person: { spans: 'value', resolved: true },
  people: { spans: 'value', resolved: true },
  channel: { spans: 'value', resolved: true },
  date: { spans: 'value', resolved: true },
};

/** Words that frame a request rather than carry a value: a value never starts or ends on one. */
const FRAME_WORDS = new Set(
  (
    'a about an add and ask called channel conversation create dm find in know let make me ' +
    'mention message named open ping please post say saying send show tell that thread to with'
  ).split(' ')
);
/** The longest short value, in words. */
const MAX_VALUE_WORDS = 6;
/** The longest value that may also run to the end of the sentence (see `asSaid`). */
const MAX_REST_WORDS = 12;
/** Keeps one question's options within what Jev takes: 51 spans plus "none". */
const MAX_PIECES = 51;
const NONE = 'none';
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const isFrame = (word: string | undefined): boolean =>
  FRAME_WORDS.has((word ?? '').replace(EDGE_PUNCTUATION, '').toLowerCase());

/**
 * Every run of words that could be a value, in the user's own spelling and punctuation, the
 * ones that end the sentence first (a message or a topic usually does), then the shortest.
 * `asSaid` also offers each ending with its framing words, for a value that is the rest of
 * the sentence ("ask it to summarise my tickets").
 */
const pieces = (text: string, asSaid: boolean): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  const max = asSaid ? MAX_REST_WORDS : MAX_VALUE_WORDS;
  for (let start = 0; start < words.length; start += 1) {
    const last = Math.min(words.length, start + max);
    const ends = Array.from({ length: last - start }, (_, index) => start + index + 1);
    // A long value runs to the end of the sentence: "tell Priya <message>".
    if (asSaid && start < max && last < words.length) ends.push(words.length);
    for (const end of ends) {
      const run = words.slice(start, end);
      const framed = isFrame(run[0]) || isFrame(run.at(-1));
      if (run.every(isFrame) || (framed && !(asSaid && end === words.length))) continue;
      const piece = run.join(' ').replace(EDGE_PUNCTUATION, '');
      if (piece) found.add(piece);
    }
  }
  const endings = [...found].filter((piece) => text.replace(EDGE_PUNCTUATION, '').endsWith(piece));
  const rest = [...found]
    .filter((piece) => !endings.includes(piece))
    .sort((a, b) => a.length - b.length);
  return [...endings, ...rest].slice(0, MAX_PIECES);
};

/**
 * Removes other fields' values, and framing words (at the end only when `trimEnd`: a long
 * value may end on one), from both ends of `text`, one at a time: with the channel "design",
 * "post in design" gives no message.
 */
const trimEdges = (text: string, others: readonly string[], trimEnd: boolean): string => {
  let words = text.split(/\s+/);
  const matches = (run: readonly string[], other: string): boolean =>
    run.join(' ').replace(EDGE_PUNCTUATION, '').toLowerCase() === other.toLowerCase();
  const trimOnce = (): boolean => {
    if (isFrame(words[0])) {
      words = words.slice(1);
      return true;
    }
    if (trimEnd && isFrame(words.at(-1))) {
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
};

/**
 * The likeliest option, when it reaches the floor. By `span` that is the option's own probability,
 * not "none against the rest": for a detail the user never gave, Jev still spreads its
 * probability over guesses, and the best of those is mostly wrong. By `said` it is everything
 * that is not "none", for a value Jev can only point at with overlapping spans.
 */
const stated = (
  answer: JevAnswer | undefined,
  { floor, by }: FieldFloor
): { option: string; score: number } | null => {
  if (answer?.type !== 'choice') return null;
  const options = Object.entries(answer.probabilities)
    .filter(([option]) => option !== NONE)
    .sort(([, left], [, right]) => right - left);
  const [best] = options;
  if (!best) return null;
  const score = by === 'said' ? options.reduce((sum, [, p]) => sum + p, 0) : best[1];
  return score >= floor ? { option: best[0], score } : null;
};

/**
 * One Jev question per field, answered from the pieces of `text`. `key` keeps the question ids
 * of different actions apart in one request, and `premise` says which action they are about.
 */
export const fieldReading = (
  fields: Record<string, AssistantRouteField>,
  text: string,
  key: (field: string) => string,
  premise: string
): FieldReading => {
  const spans = { value: pieces(text, false), rest: pieces(text, true) };
  // What each field's answer is one of: a span of the sentence, or one of its options.
  const choicesFor = (field: AssistantRouteField): string[] => {
    const { spans: source, options } = KIND_TRAITS[field.kind];
    return source === 'options' ? (field.options ?? options ?? []) : spans[source];
  };
  const questions: Record<string, JevQuestion> = {};
  for (const [name, field] of Object.entries(fields)) {
    const choices = choicesFor(field);
    if (choices.length === 0) continue;
    const isOptions = KIND_TRAITS[field.kind].spans === 'options';
    questions[key(name)] = {
      type: 'choice',
      instructions: isOptions
        ? `${premise}Which option does \`text\` give for ${field.describe}?`
        : `${premise}Which option is exactly ${field.describe}, in the user’s own words, leaving out the words that only ask for the action or name what it is about?`,
      criteria: Object.fromEntries([
        ...choices.map((choice, index) => [`o${index}`, isOptions ? choice : `“${choice}”`]),
        [
          NONE,
          'The sentence does not say it: it only asks for the action and names what it is about, without this detail.',
        ],
      ]),
    };
  }

  return {
    questions,
    read: (answers, floorFor) => {
      const read: { name: string; value: string; score: number }[] = [];
      for (const [name, field] of Object.entries(fields)) {
        const asked = floorFor(name);
        const by = KIND_TRAITS[field.kind].spans === 'rest' ? 'said' : asked.by;
        const choice = stated(answers[key(name)], { ...asked, by });
        const value = choice && choicesFor(field)[Number(choice.option.slice(1))];
        if (value && choice) read.push({ name, value, score: choice.score });
      }
      // One mention of a person or a channel fills one field ("tell #payments …" is not also a
      // person and a mention): the field Jev is surest of keeps it.
      const isResolved = (name: string): boolean =>
        KIND_TRAITS[fields[name]?.kind ?? 'text'].resolved;
      // Ties go to the field listed first, so each phrase has exactly one owner.
      const claimedBySurer = (entry: (typeof read)[number], index: number): boolean =>
        read.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            isResolved(other.name) &&
            other.value.toLowerCase() === entry.value.toLowerCase() &&
            (other.score > entry.score || (other.score === entry.score && otherIndex < index))
        );
      const found = read
        .filter((entry, index) => !isResolved(entry.name) || !claimedBySurer(entry, index))
        .map(({ name, value }): [string, string] => [name, value]);
      // The client resolves these, and an option is its own field: a text value never repeats one.
      const others = found
        .filter(([name]) => {
          const { spans: source, resolved } = KIND_TRAITS[fields[name]?.kind ?? 'text'];
          return resolved || source === 'options';
        })
        .map(([, value]) => value);
      const values: [string, string][] = [];
      for (const [name, value] of found) {
        const { spans: source, resolved } = KIND_TRAITS[fields[name]?.kind ?? 'text'];
        if (source === 'options' || resolved) {
          values.push([name, value]);
          continue;
        }
        const trimmed = trimEdges(value, others, source === 'value');
        if (!trimmed) continue;
        values.push([name, trimmed]);
        others.push(trimmed);
      }
      return Object.fromEntries(values);
    },
  };
};
