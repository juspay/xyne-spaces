import type { DialogueEvent, EngineState, ListItem, Phase } from './dialogue';
import { MAX_OPTIONS, type Resolved } from './resolve';

/**
 * Replies that need no model: "yes", "no", "cancel", "continue", or an option's label or number. They are
 * exact and instant; anything else, an answer to a text question included, goes to Jev, which
 * reads it against the question that was asked.
 */
export type Option = { id: string; label: string };
type Reply = 'yes' | 'no' | 'cancel' | 'resume' | { option: Option };

const words = (list: string): Set<string> => new Set(list.split('|'));
const YES = words(
  'yes|true|yeah|yep|yup|sure|ok|okay|go ahead|go for it|do it|confirm|please do|sounds good|haan|theek hai',
);
const NO = words("no|nope|no thanks|not now|skip|none|that's all|thats all|nahi");
const CANCEL = words('cancel|never mind|nevermind|forget it|stop|abort|rehne do');
// Said while thinking: it answers nothing, so it must never be taken for an answer.
const HESITATION = words('hmm|umm|uh|wait|hold on|one sec|let me think');
// A short sentence that starts with one of these is a question, not an answer.
const QUESTION_STARTS = words(
  'what|why|how|who|when|where|which|can|could|is|are|do|does|should|would|will',
);
const MAX_ANSWER_WORDS = 8;
// Back to the request after a detour: its open question is asked again.
const RESUME = words("continue|go on|carry on|resume|where were we|back to it|let's continue");
// By position: "the second one", in Hindi too: "doosra wala".
const ORDINALS = new Map(
  [
    ['first', 'pehla', 'pehli', 'pahla'],
    ['second', 'doosra', 'dusra', 'doosri', 'dusri'],
    ['third', 'teesra', 'tisra', 'teesri'],
    ['fourth', 'chautha', 'chauthi'],
    ['fifth', 'paanchva', 'panchva'],
    ['sixth', 'chhatha'],
  ].flatMap((names, index) => names.map(name => [name, index + 1] as const)),
);

// Said around a reply without changing it: "yes please", "never mind lol".
const FILLER = words('please|thanks|thank you|lol|then|now|just|oh|ah|ok|okay|in it|with it|it');

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.,!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// What a pick may start or end with: "can you open the first one please", "actually the second
// one", "pehla wala kholo". A word said twice, as speech often has it ("open the the second one"),
// counts once.
const PICK_LEAD =
  /^(?:(?:can|could|would) you |please |just |now |ok |okay |and |actually |no )*(?:open |show me |show |pick |choose |select |take |go with |go to )?/;
const PICK_TAIL = /(?: instead| please| kholo| dikhao| khol do)+$/;
const pickWords = (said: string): string =>
  said
    .replace(/\b(\w+)( \1\b)+/g, '$1')
    .replace(PICK_LEAD, '')
    .replace(PICK_TAIL, '');

// "second", "2", "2nd" -> 2; anything else -> 0.
const positionOf = (token: string): number => {
  const number = Number(token.replace(/^(\d+)(?:st|nd|rd|th)$/, '$1'));
  return Number.isInteger(number) ? number : (ORDINALS.get(token) ?? 0);
};

// "the second one", "number 2", "2", "2nd" -> 2; anything else -> 0.
const ordinal = (said: string): number =>
  positionOf(
    /^(?:the |number |option )?(\w+)(?: one| wala| waala)?$/.exec(pickWords(said))?.[1] ?? '',
  );

// A pick by position that more words follow: "open the first one, onboarding channel". Of a list
// on screen, the position is what is picked; the words after it only describe it.
const leadingOrdinal = (said: string): number =>
  ordinal(said) ||
  positionOf(
    /^(?:the |number |option )?(\w+) (?:one|wala|waala)\b/.exec(pickWords(said))?.[1] ?? '',
  );

// Whether the reply is made only of the list's phrases and filler: "yep do it" is yes, while
// "yes call it Bob" or "yes but wait" carry more and go to Jev.
function says(list: Set<string>, said: string): boolean {
  let rest = said;
  let matched = false;
  while (rest) {
    const head = [...list, ...FILLER].find(
      phrase => rest === phrase || rest.startsWith(`${phrase} `),
    );
    if (!head) return false;
    matched ||= list.has(head);
    rest = rest.slice(head.length).trim();
  }
  return matched;
}

export const isYes = (text: string): boolean => says(YES, normalize(text));

export const isHesitation = (text: string): boolean => says(HESITATION, normalize(text));

// Short and not a question: for a text question, that is the answer as said. Code decides this,
// so Ask AI is not woken for "Marketing launch".
export function isShortAnswer(text: string): boolean {
  const said = normalize(text);
  const [first = ''] = said.split(' ');
  return (
    !text.includes('?') && said.split(' ').length <= MAX_ANSWER_WORDS && !QUESTION_STARTS.has(first)
  );
}

// The one option whose label contains what was said as whole words: "Sharma" for "Deepanshu
// Sharma". Only when it is unambiguous; otherwise the reply goes on to Jev, which has the context.
function withinLabel(options: readonly Option[], said: string): Option | undefined {
  const tokens = said.split(' ');
  const contains = (label: string): boolean => {
    const parts = normalize(label).split(' ');
    return parts.some((_, start) => tokens.every((token, i) => parts[start + i] === token));
  };
  const matching = options.filter(item => contains(item.label));
  return matching.length === 1 ? matching[0] : undefined;
}

// Said around an option without changing it: "it should be public", "make it private", "as an
// admin", "private wala". A word that changes it ("not", "shouldn't") is not among them.
const OPTION_LEAD = words(
  "it|it's|its|should|be|make|keep|set|to|as|go|with|let's|i|want|prefer|the|a|an|is|will|would",
);
const OPTION_TAIL = words('please|wala|waala|one|then|only|rakho|karo|it');
function optionWords(said: string): string {
  const tokens = said.split(' ');
  while (tokens.length > 1 && OPTION_LEAD.has(tokens[0] ?? '')) tokens.shift();
  while (tokens.length > 1 && OPTION_TAIL.has(tokens.at(-1) ?? '')) tokens.pop();
  return tokens.join(' ');
}

// `shown`: how many of the options are on screen, which are all a position can pick; a name may
// pick any of them. A position may run on: "the first one, onboarding channel".
export function replyTo(
  text: string,
  options: readonly Option[] = [],
  shown = options.length,
): Reply | null {
  const said = normalize(text);
  if (says(CANCEL, said)) return 'cancel';
  if (says(RESUME, said)) return 'resume';
  // An option on screen wins over yes/no, so an option labelled "None" is picked, not read as "no".
  const bare = optionWords(said);
  const option =
    options.find(item => normalize(item.label) === said) ??
    options.find(item => normalize(item.label) === bare) ??
    withinLabel(options, said) ??
    options.slice(0, shown)[leadingOrdinal(said) - 1];
  if (option) return { option };
  if (says(YES, said)) return 'yes';
  return says(NO, said) ? 'no' : null;
}

/** The item of a list that a position picks: "the second one", "doosra wala"; none for other words. */
export const itemAt = (items: readonly ListItem[], text: string): ListItem | undefined => {
  const position = leadingOrdinal(normalize(text));
  return position > 0 ? items[position - 1] : undefined;
};

/**
 * Of the people or channels a choice is between, those a reply names by the start of a word of
 * their name ("Khan", "sara k") or by a part of their email ("sara.k@"). None when it names none
 * of them, or all of them: then it says nothing about which.
 */
export function narrowedBy(options: readonly Resolved[], text: string): Resolved[] {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/[,.!?]+$/, '');
  if (said.length < 2) return [];
  const fits = options.filter(
    ({ label, email }) =>
      // "perf" starts a word of mobile-perf.
      ` ${label.toLowerCase().replace(/[-_#]/g, ' ')}`.includes(` ${said}`) ||
      !!email?.toLowerCase().includes(said),
  );
  return fits.length < options.length ? fits : [];
}

// The field the open question is about, while it is asked or its matches are chosen from.
export const askedField = (phase: Phase): string | null =>
  phase.kind === 'collecting' || phase.kind === 'choosing' ? phase.field : null;

export type QuickWord = 'yes' | 'no' | 'cancel' | 'resume' | 'ordinal';

/** What the text is when no question is open for it to answer; null when it is something else. */
export function quickWord(text: string): QuickWord | null {
  const reply = replyTo(text);
  if (typeof reply === 'string') return reply;
  return ordinal(normalize(text)) > 0 ? 'ordinal' : null;
}

/**
 * The text as the answer to the question being asked, word for word: for when Jev is unavailable
 * or knows no better. A quick word ("yes", "no", "the second one") is never a name or a
 * description.
 */
export function verbatim(state: EngineState, text: string): DialogueEvent | null {
  const field = state.phase.kind === 'collecting' ? state.phase.field : null;
  const kind = field && state.action.fields[field]?.kind;
  return field && (kind === 'text' || kind === 'longtext') && quickWord(text) === null
    ? { type: 'fields', values: { [field]: text.trim() } }
    : null;
}

// "the name", "visibility": while asking what to change, the field the text names.
function namedField(state: EngineState, text: string): DialogueEvent | null {
  const said = normalize(text).replace(/^the /, '');
  const field = Object.entries(state.action.fields).find(
    ([id, { label }]) => id === said || normalize(label) === said,
  )?.[0];
  return field ? { type: 'ask', field } : null;
}

// What may be said of a list on screen, besides a pick and more words for the search. Longest
// first, so "next ones" is not read as "next" and a stray "ones".
const phrases = (list: string): Set<string> =>
  new Set(list.split('|').sort((a, b) => b.length - a.length));
const MORE = phrases(
  'more|show more|show me more|see more|more results|next|next ones|next one|the next ones|show the next ones|aur dikhao',
);
const REFINE = phrases(
  'none of these|none of them|not these|neither|something else|tell me more|koi nahi|none',
);
// Of more people or channels than were offered: one not offered is meant.
const SOMEONE_ELSE = phrases('someone else|somebody else|another one|koi aur');
const BACK = phrases(
  'go back|back|undo|widen|widen it|widen it back|widen the search|search wider',
);

// "the one from Tom", "Tom's": the words that name an item, without what goes around them.
const naming = (said: string): string =>
  pickWords(said)
    .replace(/^(?:the )?(?:one |message |thread |ticket )?(?:from |by )?/, '')
    .replace(/'s\b/g, '')
    .replace(/(?: one| wala)$/, '')
    .trim();

// The one item whose label holds the words as whole words; none when several or none do. The
// label is who or what it is, never where: "in #product" narrows the search, it picks nothing.
function named(items: readonly ListItem[], said: string): ListItem | undefined {
  const name = naming(said);
  if (!name) return undefined;
  const tokens = name.split(' ');
  const matching = items.filter(({ label }) => {
    const parts = normalize(label).replace(/'s\b/g, '').replace(/#/g, '').split(' ');
    return parts.some((_, start) => tokens.every((token, i) => parts[start + i] === token));
  });
  return matching.length === 1 ? matching[0] : undefined;
}

// A list on screen: a pick by position on the card or by name, the next items, none of these,
// or back. Positions count from the first item on the card.
function listEvent(
  { list: { items }, start }: Extract<Phase, { kind: 'results' }>,
  text: string,
): DialogueEvent | null {
  const said = normalize(text);
  if (says(MORE, said)) return { type: 'more' };
  if (says(REFINE, said)) return { type: 'refine' };
  if (says(BACK, said)) return { type: 'back' };
  const position = leadingOrdinal(said);
  const item = position > 0 ? items[start + position - 1] : named(items, said);
  return item ? { type: 'open', item } : null;
}

// While several fit: one not offered, or a part of a name or email that narrows them, to one
// picked or to fewer to choose from. Never a pick the reply does not single out.
// The words first said stay the field's value: "Which Sara?" still.
function choosingEvent({ values, phase }: EngineState, text: string): DialogueEvent | null {
  if (phase.kind !== 'choosing') return null;
  const { field, options } = phase;
  if (says(SOMEONE_ELSE, normalize(text))) return { type: 'refine' };
  const fits = narrowedBy(options, text);
  const [only] = fits;
  if (!only) return null;
  return fits.length === 1
    ? { type: 'chosen', field, pick: only }
    : {
        type: 'fields',
        values: { [field]: values[field] ?? text.trim() },
        resolutions: { [field]: { kind: 'many', options: fits } },
      };
}

/** The dialogue event the text amounts to without asking a model, if it is one. */
export function quickEvent(state: EngineState, text: string): DialogueEvent | null {
  const field = askedField(state.phase);
  const definition = field ? state.action.fields[field] : undefined;
  const { phase } = state;
  if (phase.kind === 'results') {
    // "Yes" or "ok" wins over an item it happens to name.
    const word = quickWord(text);
    const event = listEvent(phase, text);
    return word && word !== 'ordinal' && (!event || event.type === 'open') ? { type: word } : event;
  }
  // The people or channels that fit the words said are the options to pick from; only those on
  // the card are picked by position.
  const reply =
    phase.kind === 'choosing'
      ? replyTo(text, phase.options, MAX_OPTIONS)
      : replyTo(text, definition?.options);
  if (reply === 'cancel') return { type: 'cancel' };
  if (reply === 'resume') return { type: 'resume' };
  if (reply && typeof reply === 'object') {
    if (phase.kind === 'choosing')
      return { type: 'chosen', field: phase.field, pick: reply.option };
    return field ? { type: 'fields', values: { [field]: reply.option.label } } : null;
  }
  const narrowing = reply ? null : choosingEvent(state, text);
  if (narrowing) return narrowing;
  // "Did you mean Sara Iyer?": yes picks the one offered.
  const [only, another] = phase.kind === 'choosing' ? phase.options : [];
  if (reply === 'yes' && phase.kind === 'choosing' && only && !another) {
    return { type: 'chosen', field: phase.field, pick: only };
  }
  // Yes answers a confirmation, a choice or an offer, never a required question; no may skip any
  // field, and is told what is needed when it cannot.
  if (reply === 'yes' || reply === 'no') {
    // While asking what to change, either one keeps the request as it is.
    const revising = phase.kind === 'collecting' && !phase.field;
    const answers =
      revising ||
      phase.kind === 'confirming' ||
      phase.kind === 'choosing' ||
      (definition && (!definition.required || reply === 'no'));
    if (answers) return { type: reply };
    // "Yes" to a question that wants a value means go on: the question is put again.
    return phase.kind === 'collecting' && field ? { type: 'resume' } : null;
  }
  return phase.kind === 'collecting' && !phase.field ? namedField(state, text) : null;
}
