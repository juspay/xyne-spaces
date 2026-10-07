import { fillTemplate, hasValue, type ActionDefinition, type FieldKind } from '../actions/action';
import { ACTIONS } from '../catalog';
import type { Route } from '../router';
import {
  listOf,
  openQuestion,
  putAgain,
  SOMEONE_ELSE,
  startDialogue,
  TELL_ME_MORE,
  type DialogueEvent,
  type EngineState,
  type ListItem,
  type ShownResults,
} from './dialogue';
import {
  isHesitation,
  isShortAnswer,
  itemAt,
  quickEvent,
  quickWord,
  replyTo,
  verbatim,
  type Option,
} from './quickReplies';
import { emailsIn } from './email';
import { holdsSecret, NO_SECRETS } from './secrets';
import {
  channelNamed,
  isEveryone,
  resolve,
  resolveField,
  type Directory,
  type Resolution,
} from './resolve';

/**
 * Decides what a sentence amounts to, before Jev is asked and after. Pure: no page, no store, no
 * network. It never acts; it says what should happen, and the caller does it.
 */

// The actions Jev could not choose between, put to the user as a card to tap. `said`: the
// sentence, when the card offers to hand it to Ask AI instead. `offer`: the card asks whether to
// do its one action ("Want me to add them to the organisation first?"), so yes takes it.
export interface Unsure {
  actions: ActionDefinition[]; // those that can be switched to
  fields: Record<string, Record<string, string>>;
  said?: string;
  offer?: boolean;
}

export interface InterpretContext {
  dialogue: EngineState | null; // the request under way
  aside: EngineState | null; // a request put on hold after off-topic replies
  unsure: Unsure | null; // the "did you mean" card on screen
  list?: ShownResults | null; // the list on screen, which "the second one" picks from with no request open
  // What Buddy can do, while it is working with the user: in voice mode, or just after it did
  // something. A sentence that names one of these is then asked about, never sent off silently.
  engaged?: readonly ActionDefinition[];
}

export type Decision =
  // Advance this state, which may be new. `aside`: the request it was switched to from, which
  // waits to be picked up with "continue".
  | { kind: 'event'; state: EngineState; event: DialogueEvent; aside?: EngineState }
  | { kind: 'say'; text: string } // a reply of its own; the question about which action is closed
  | { kind: 'no_access'; action: ActionDefinition; text: string } // hidden by role: said, never done
  | { kind: 'wait'; text: string } // a reply that changes nothing, the cards on screen included
  // Where to do these, ending any dialogue; `how`: the user asked how, so the steps are said.
  | { kind: 'show'; actions: ActionDefinition[]; how?: boolean }
  | { kind: 'list_actions' } // what the user can do here; any open request stays as it is
  | { kind: 'unsure'; unsure: Unsure; question: string; options: Option[] }
  // The action picked on the card that offered it for a sentence Jev read no field from: the
  // sentence is read again for that action alone, with the card's question pending, and then
  // `interpretRead` starts it.
  | { kind: 'read'; action: ActionDefinition; said: string; question: string }
  | { kind: 'busy' } // the run is under way
  | { kind: 'cancel_run' } // "cancel" while it is: stopped if nothing was sent yet
  | { kind: 'open'; item: ListItem } // an item of the list on screen, picked with no request open
  | { kind: 'missed'; state: EngineState } // not about the open question: kept, with the miss counted
  | { kind: 'hold'; text: string } // missed again: the request is put aside, as `text` says
  | { kind: 'ask_ai'; text?: string }; // `text`: what Ask AI is asked, when not the sentence itself

// Replies in a row that are not about the open question, after which the request is put aside.
const MAX_MISSES = 2;

// How likely (0 to 1, from Jev) a sentence must be the answer to the open question for a short
// statement that no field was read from to be taken as written. Below it, "tell me a joke" and
// "explain kubernetes" are requests for Ask AI, not a name. On the tune split requests reach
// 0.6 at most; from 0.7 the backend itself calls a sentence the answer.
export const SHORT_ANSWER_FLOOR = 0.65;

// The most actions the user is asked to choose between: the likeliest first.
const MAX_CHOICES = 3;

const KEEP = 'keep';
const ELSE = 'else';
const ASK_AI = 'ask_ai';

const TAKE_YOUR_TIME = 'Take your time.';
const NOT_CAUGHT = "Sorry, I didn't catch that.";

// A few words that speech to text cut off: "What are you-", "so the…".
const MAX_CUT_OFF_WORDS = 3;
const isCutOff = (said: string): boolean =>
  /(?:[-–—…]|\.\.\.)$/.test(said) && said.split(/\s+/).length <= MAX_CUT_OFF_WORDS;
const TELL_ME = "Okay, tell me what you'd like to do.";

// "How do I…", "where can I…", "…kaise": a question about how to do it, not a request to.
// "Where did we talk about…" is a search, so only "where" with "can", "do" or "should I" counts.
const HOW_TO =
  /\b(?:how (?:do|can|could|would|should) (?:i|we|you)|how to|where (?:do|can|could|should) (?:i|we)|kaise)\b/i;

// Verbs that ask Buddy to do something, each as the first word of the titles of the actions it
// may ask for: "message Sara" sends a message. Said in a question ("what does mention do?"), they
// ask nothing.
const VERBS: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries({
    send: ['send'],
    message: ['send'],
    post: ['send'],
    mention: ['send'],
    tag: ['send'],
    reply: ['send'],
    dm: ['send'],
    ping: ['send'],
    find: ['find'],
    search: ['find'],
    add: ['add'],
    invite: ['invite'],
    create: ['create'],
    make: ['create', 'change'],
    remove: ['remove'],
    kick: ['remove'],
    rename: ['rename'],
    open: ['browse', 'manage', 'start'],
  }),
);
const QUESTION = /^(?:what|why|how|who|when|where|which)\b/i;
const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z]+/g) ?? []).map(word => word.replace(/s$/, ''));

/**
 * The action a verb in the text most likely asks for: of the actions whose title starts with it,
 * the one more of whose other title words were said ("create an agent"). None when no such verb
 * is said, when the text is a question, or when several fit and nothing tells them apart.
 */
export function verbAction(
  text: string,
  actions: readonly ActionDefinition[],
): ActionDefinition | undefined {
  if (QUESTION.test(text.trim())) return undefined;
  const said = new Set(wordsOf(text));
  const verbs = new Set([...said].flatMap(word => VERBS.get(word) ?? []));
  const scored = actions
    .map(action => {
      const [verb = '', ...rest] = wordsOf(action.title);
      return { action, verb, score: rest.filter(word => said.has(word)).length };
    })
    .filter(({ verb }) => verbs.has(verb))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && (!next || best.score > next.score) ? best.action : undefined;
}

// Said before the verb of a request: "can you", "please".
const POLITE = /^(?:(?:can|could|would|will) you\s+|please\s+|pls\s+|just\s+|now\s+)*/i;

// Whether the sentence starts by asking for this action by its verb: "Can you invite a user?".
const asksFirst = (text: string, action: ActionDefinition): boolean => {
  const [first = ''] = text.trim().replace(POLITE, '').split(/\s+/);
  return verbAction(first, [action]) === action;
};

// An action with fields to read, or that does more than open a page, is carried out through a
// dialogue. One that only opens a page is opened, with its pill to open it again.
export const isOperable = (action: ActionDefinition): boolean =>
  Object.keys(action.fields).length > 0 || action.plan.some(step => step.op !== 'open_page');

// The words said for each person, channel or date, matched to the records they mean. `said`: the
// whole sentence, from which an email address is read, since one said aloud ("vinit dot khandal
// at juspay dot in") runs longer than the words Jev reads as a value.
export function fieldsEvent(
  action: ActionDefinition,
  values: Record<string, string>,
  directory: Directory,
  said?: string,
): DialogueEvent {
  const addresses = said ? emailsIn(said) : [];
  const read = { ...values };
  const email = Object.entries(action.fields).find(([, { parse }]) => parse === 'email')?.[0];
  if (email && addresses.length > 0) read[email] = addresses.join(', ');
  const resolutions: Record<string, Resolution> = {};
  for (const [field, words] of Object.entries(read)) {
    const definition = action.fields[field];
    const resolution =
      definition && hasValue(words) ? resolveField(definition, words, directory) : null;
    if (resolution) resolutions[field] = resolution;
  }
  return { type: 'fields', values: read, resolutions };
}

// "dm everyone in the company": a request for one person, said for a group, is not one any action
// does, so Ask AI answers it. "Tell everyone in #general …" still goes to the channel said.
function forEveryone(action: ActionDefinition, values: Record<string, string>): boolean {
  const oneOf = action.requireOneOf ?? [];
  return Object.entries(action.fields).some(
    ([field, { kind, required }]) =>
      (kind === 'person' || kind === 'people') &&
      (required || oneOf.includes(field)) &&
      isEveryone(values[field] ?? '') &&
      !oneOf.some(other => other !== field && hasValue(values[other])),
  );
}

// The action carried out with what was read for it; one that only opens a page is just shown, and
// listing the actions leaves the open request as it is. The same action as the open one continues
// it.
function start(
  action: ActionDefinition,
  fields: Record<string, Record<string, string>>,
  directory: Directory,
  current: EngineState | null = null,
  said?: string,
): Decision {
  if (action.plan.some(step => step.op === 'list_actions')) return { kind: 'list_actions' };
  if (!isOperable(action)) return { kind: 'show', actions: [action] };
  const values = fields[action.id] ?? {};
  if (current?.action.id === action.id) {
    return { kind: 'event', state: current, event: fieldsEvent(action, values, directory, said) };
  }
  return {
    kind: 'event',
    state: startDialogue(action),
    event: fieldsEvent(action, withHere(action, values, directory), directory, said),
  };
}

// Where a request goes, when it was not said, is the conversation the user is looking at: "ask Ask
// AI to do an RCA" in the thread on screen. The confirm card names it, so it is never a guess.
function withHere(
  action: ActionDefinition,
  values: Record<string, string>,
  { here }: Directory,
): Record<string, string> {
  const place = Object.entries(action.fields).find(
    ([field, { kind, required }]) =>
      kind === 'channel' && (required || action.requireOneOf?.includes(field)),
  )?.[0];
  const said = (action.requireOneOf ?? [place]).some(field => field && hasValue(values[field]));
  return place && here && !said ? { ...values, [place]: 'here' } : values;
}

const say = (text: string): Decision => ({ kind: 'say', text });

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const optionsOf = ({ actions, said }: Unsure, dialogue: EngineState | null): Option[] =>
  dialogue
    ? [
        ...actions.map(({ id, title }) => ({ id, label: `Switch to ${title}` })),
        { id: KEEP, label: `Keep going with ${dialogue.action.title}` },
      ]
    : [
        ...actions.map(({ id, title }) => ({ id, label: title })),
        said ? { id: ASK_AI, label: 'Ask Xyne AI' } : { id: ELSE, label: 'Something else' },
      ];

// What one option of the card comes to; null when it is not one of them.
function chosen(
  context: InterpretContext,
  optionId: string,
  directory: Directory,
): Decision | null {
  const { dialogue, unsure } = context;
  if (!unsure) return null;
  if (optionId === KEEP) {
    return dialogue ? { kind: 'event', state: dialogue, event: { type: 'resume' } } : null;
  }
  if (optionId === ELSE) return say(TELL_ME);
  if (optionId === ASK_AI && unsure.said) return { kind: 'ask_ai', text: unsure.said };
  const action = unsure.actions.find(({ id }) => id === optionId);
  if (!action) return null;
  // Offered for a sentence Jev read as Ask AI's, so with nothing read for it: it is read again.
  if (unsure.said && isOperable(action) && Object.keys(action.fields).length > 0) {
    return { kind: 'read', action, said: unsure.said, question: questionOf(unsure, dialogue) };
  }
  return switchTo(dialogue, action, unsure.fields, directory, unsure.said);
}

// A request started from the card. One switched to from a request still open leaves that one
// aside, to pick up with "continue" once this one is done: an invitation after adding the person
// to the organisation.
function switchTo(
  dialogue: EngineState | null,
  action: ActionDefinition,
  fields: Record<string, Record<string, string>>,
  directory: Directory,
  said?: string,
): Decision {
  const started = start(action, fields, directory, null, said);
  return dialogue && started.kind === 'event' ? { ...started, aside: dialogue } : started;
}

/**
 * What a refused run offers next: the action its `onRefused` names for these words, when the
 * user may do it, as a card that asks whether to, with the values the two actions share. Null
 * when there is none.
 */
export function offerAfterRefusal(
  state: EngineState,
  error: string,
  actions: readonly ActionDefinition[],
): { text: string; unsure: Unsure; options: Option[] } | null {
  const rule = state.action.onRefused?.find(({ when }) => when.test(error));
  const offered = rule && actions.find(({ id }) => id === rule.offer);
  if (!rule || !offered) return null;
  const shared = Object.keys(offered.fields).flatMap(field => {
    const value = state.values[field];
    return hasValue(value) ? [[field, value] as const] : [];
  });
  const unsure: Unsure = {
    actions: [offered],
    fields: { [offered.id]: Object.fromEntries(shared) },
    offer: true,
  };
  return {
    text: fillTemplate(rule.say, state.values),
    unsure,
    options: optionsOf(unsure, state),
  };
}

// The card's question, as it was put.
function questionOf(unsure: Unsure, dialogue: EngineState | null): string {
  const [only] = unsure.actions;
  if (unsure.said && only) return `Do you want me to ${lowerFirst(only.title)}, or ask Xyne AI?`;
  return `Did you mean ${listOf(optionsOf(unsure, dialogue).map(({ label }) => label))}?`;
}

/**
 * The action picked on the card, started with what Jev read for it alone (`route`), and where the
 * user is: "No message in test V2 channel mentioning Sara Iyer…" names who to mention.
 */
export function interpretRead(
  { action, said }: Extract<Decision, { kind: 'read' }>,
  route: Route,
  directory: Directory,
): Decision {
  const values =
    route.kind === 'answer'
      ? route.fields
      : route.kind === 'actions' || route.kind === 'unsure'
        ? (route.fields[action.id] ?? {})
        : {};
  return start(action, { [action.id]: values }, directory, null, said);
}

// The card is answered by an option's title or number; "continue" keeps going, and "no" or
// "cancel" leaves the choice open to anything else. Anything more is left to the usual rules.
function answerCard(
  context: InterpretContext,
  text: string,
  directory: Directory,
): Decision | null {
  const { dialogue, unsure } = context;
  if (!unsure) return null;
  const reply = replyTo(text, optionsOf(unsure, dialogue));
  const [offered] = unsure.actions;
  if (reply === 'yes' && unsure.offer && offered) return chosen(context, offered.id, directory);
  if (reply === 'cancel' || reply === 'no') return chosen(context, ELSE, directory);
  if (reply === 'resume') return chosen(context, KEEP, directory);
  return reply && typeof reply === 'object' ? chosen(context, reply.option.id, directory) : null;
}

// The words that bring in who, where or when a list on screen is narrowed to: "in #ops", "from
// Rahul". A date needs none: "last week", "from yesterday".
const NARROWED_BY: Readonly<Record<string, FieldKind>> = {
  in: 'channel',
  from: 'person',
  with: 'person',
  by: 'person',
};
// Said around a narrowing without adding to it: "okay, in #sales", "no, in #ops", "the one from
// yesterday", "the ops one", "it's from Tom".
const NARROWING_LEAD = new Set(
  `ok okay no nah actually and also just only now then so maybe the one ones messages
  it it's its was`.split(/\s+/),
);
const NARROWING_TAIL = new Set('one ones only please instead then'.split(' '));
// The longest date keyword, in words: "last 24 hours".
const MAX_DATE_WORDS = 3;

/**
 * A narrowing of the list on screen made only of people, channels and dates the action searches
 * by, each named exactly as said, found here with no Jev call. Null when anything else is said, a topic or a question: the
 * sentence then goes to Jev as before. Words without "in", "from", "with" or "by" count only as a
 * date, a channel said as one ("onboarding channel", "#ops"), or a channel named exactly ("ops")
 * and not yet in the search: alone they may as well be the topic.
 */
function narrowing(
  dialogue: EngineState,
  text: string,
  directory: Directory,
): DialogueEvent | null {
  const words = text
    .replace(/[,.!?;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const word = (at: number): string => (words[at] ?? '').toLowerCase();
  const said = (from: number, to: number): string => words.slice(from, to).join(' ');
  let start = 0;
  let end = words.length;
  while (start < end && NARROWING_LEAD.has(word(start))) start += 1;
  // "Open with Tom" narrows by Tom; "open #ops" may mean the channel itself, so Jev reads it.
  if (word(start) === 'open' && NARROWED_BY[word(start + 1)]) start += 1;
  while (end > start && NARROWING_TAIL.has(word(end - 1))) end -= 1;
  // Where the date keyword starting at `at` ends; `at` itself when none starts there.
  const dateEnd = (at: number): number => {
    for (let to = Math.min(end, at + MAX_DATE_WORDS); to > at; to -= 1) {
      if (resolve('date', said(at, to), directory)?.kind === 'one') return to;
    }
    return at;
  };
  // One part of the narrowing: a date, or "in", "from", "with" or "by" and the words up to the
  // next part, or words that name a channel exactly.
  const part = (
    at: number,
  ): { kind: FieldKind; from: number; to: number; found: Resolution | null } => {
    const marked = NARROWED_BY[word(at)];
    const from = marked ? at + 1 : at;
    const dated = dateEnd(from);
    if (dated > from) {
      return {
        kind: 'date',
        from,
        to: dated,
        found: resolve('date', said(from, dated), directory),
      };
    }
    let to = from;
    while (to < end && !NARROWED_BY[word(to)] && dateEnd(to) === to) to += 1;
    if (marked) {
      return {
        kind: marked,
        from,
        to,
        found: to > from ? resolve(marked, said(from, to), directory, true) : null,
      };
    }
    // Words said as a channel ("onboarding channel", "#ops") are found as any channel is.
    if (/^#|\bchannel$/i.test(said(from, to))) {
      const found = resolve('channel', said(from, to), directory, true);
      return { kind: 'channel', from, to, found };
    }
    // Words the search already holds are no narrowing: "onboarding" again, with that the topic.
    const again = Object.values(dialogue.values).some(value =>
      value?.toLowerCase().includes(said(from, to).toLowerCase()),
    );
    const pick = again ? null : channelNamed(said(from, to), directory);
    return { kind: 'channel', from, to, found: pick && { kind: 'one', pick } };
  };

  const values: Record<string, string> = {};
  const resolutions: Record<string, Resolution> = {};
  for (let at = start; at < end; ) {
    const { kind, from, to, found } = part(at);
    const field = Object.entries(dialogue.action.fields).find(
      ([, definition]) => definition.kind === kind,
    )?.[0];
    // Anything that is not a person, channel or date the search takes is for Jev, as is the same
    // field said twice.
    if (!field || field in values || !found || found.kind === 'none') return null;
    values[field] = said(from, to);
    resolutions[field] = found;
    at = to;
  }
  return Object.keys(values).length > 0 ? { type: 'fields', values, resolutions } : null;
}

// Said around a person, channel, date or address without being part of it: "it's with Tom", "in
// the onboarding channel", "from last week", "to Priya please".
const ANSWER_LEAD =
  /^(?:(?:it'?s|it is|it was|that'?s|its)\s+)?(?:(?:with|from|by|in|to|for)\s+)?/i;
const ANSWER_TAIL = /\s+(?:please|only|instead)$/i;
const answerWords = (text: string): string =>
  text
    .replace(/[.!?,]+$/, '')
    .trim()
    .replace(ANSWER_LEAD, '')
    .replace(ANSWER_TAIL, '');

function withDialogue(dialogue: EngineState, text: string, directory: Directory): Decision | null {
  const quick = quickEvent(dialogue, text);
  if (quick) return { kind: 'event', state: dialogue, event: quick };
  // A sentence that asks for something Buddy does ("message Priya…") is a request of its own,
  // never an answer: Jev reads it.
  if (verbAction(text, ACTIONS)) return null;
  if (dialogue.phase.kind === 'results') {
    const narrowed = narrowing(dialogue, text, directory);
    return narrowed && { kind: 'event', state: dialogue, event: narrowed };
  }
  // A person, channel, date or email address the open question asks for, named exactly as said:
  // no Jev call needed. A near match is left to Jev, which reads the whole sentence.
  const field = openQuestion(dialogue)?.field;
  const definition = field ? dialogue.action.fields[field] : undefined;
  const words = answerWords(text);
  const found = definition && words ? resolveField(definition, words, directory, true) : null;
  if (field && found && found.kind !== 'none') {
    const event: DialogueEvent = {
      type: 'fields',
      values: { [field]: words },
      resolutions: { [field]: found },
    };
    return { kind: 'event', state: dialogue, event };
  }
  return null;
}

// With no request open, a request put on hold is picked up or dropped. Opening an item ended the
// search, but its list is still on screen: "actually the second one" opens another. Any other
// "yes" or "no", or "2" with no list on screen, answers Ask AI's own follow-up question, so it is
// left to Ask AI.
function withoutDialogue({ aside, list }: InterpretContext, text: string): Decision | null {
  const word = quickWord(text);
  if (aside && (word === 'resume' || word === 'yes')) {
    return { kind: 'event', state: aside, event: { type: 'resume' } };
  }
  if (aside && (word === 'cancel' || word === 'no')) {
    return { kind: 'event', state: aside, event: { type: 'cancel' } };
  }
  // "the second one", with whatever trails it.
  const item = (word === 'ordinal' || word === null) && list ? itemAt(list.items, text) : undefined;
  return item ? { kind: 'open', item } : null;
}

/**
 * What the text amounts to without asking Jev, if it amounts to anything; null means Jev is
 * asked. Exact and instant: a quick word, an option's label, a person or channel found as said.
 */
export function interpretLocally(
  context: InterpretContext,
  text: string,
  directory: Directory,
): Decision | null {
  const said = text.trim();
  const { dialogue, aside, unsure } = context;
  // A secret is never read into a field, nor sent to Jev. Only an open question could take it in;
  // with none, it goes to Ask AI as it did before Buddy.
  if (holdsSecret(said)) {
    return dialogue || aside || unsure ? { kind: 'say', text: NO_SECRETS } : { kind: 'ask_ai' };
  }
  // While the run is under way every sentence is answered the same: it is under way, but "cancel"
  // stops it.
  if (dialogue?.phase.kind === 'submitting') {
    return replyTo(said) === 'cancel' ? { kind: 'cancel_run' } : { kind: 'busy' };
  }
  // Only something open is waited on; with nothing open, "hmm" is for Ask AI like any other text.
  if ((dialogue || aside || unsure) && isHesitation(said)) {
    return { kind: 'wait', text: TAKE_YOUR_TIME };
  }
  const answered = answerCard(context, said, directory);
  if (answered) return answered;
  const decided = dialogue
    ? withDialogue(dialogue, said, directory)
    : withoutDialogue(context, said);
  if (decided || !isCutOff(said)) return decided;
  // Cut off by speech to text while a card waits on the user: its question is put again.
  const phase = dialogue?.phase.kind;
  if (dialogue && (phase === 'confirming' || phase === 'choosing')) {
    return { kind: 'wait', text: `${NOT_CAUGHT} ${putAgain(dialogue)}` };
  }
  return unsure ? { kind: 'wait', text: `${NOT_CAUGHT} ${questionOf(unsure, dialogue)}` } : null;
}

/** What tapping an option of the card on screen comes to; null when it is not one of them. */
export function interpretTap(
  context: InterpretContext,
  optionId: string,
  directory: Directory,
): Decision | null {
  const { dialogue, unsure } = context;
  if (unsure) return chosen(context, optionId, directory);
  if (!dialogue) return null;
  if (dialogue.phase.kind === 'submitting' && optionId === 'cancel') return { kind: 'cancel_run' };
  if (optionId === 'yes' || optionId === 'cancel') {
    return { kind: 'event', state: dialogue, event: { type: optionId } };
  }
  const { phase } = dialogue;
  if (phase.kind === 'results') {
    if (optionId === TELL_ME_MORE.id) {
      return { kind: 'event', state: dialogue, event: { type: 'refine' } };
    }
    const item = phase.list.items.find(({ id }) => id === optionId);
    return item ? { kind: 'event', state: dialogue, event: { type: 'open', item } } : null;
  }
  if (phase.kind === 'choosing' && optionId === SOMEONE_ELSE.id) {
    return { kind: 'event', state: dialogue, event: { type: 'refine' } };
  }
  const pick = phase.kind === 'choosing' && phase.options.find(({ id }) => id === optionId);
  return pick
    ? { kind: 'event', state: dialogue, event: { type: 'chosen', field: phase.field, pick } }
    : null;
}

// Which action was meant, put to the user: to switch to another while one is open, or to say which.
function askWhich(
  context: InterpretContext,
  text: string,
  route: Extract<Route, { kind: 'unsure' }>,
  directory: Directory,
): Decision {
  const { dialogue } = context;
  // One action in doubt that only reads or opens, asked for by its verb ("find…") with something
  // read for it: asking whether it is wanted adds a step and protects nothing. "Summarise what
  // Priya said" names no verb of it, so it is still asked about.
  const [only] = route.actions;
  if (
    only &&
    route.actions.length === 1 &&
    (only.effect === 'read' || only.effect === 'navigate') &&
    Object.keys(route.fields[only.id] ?? {}).length > 0 &&
    (!dialogue || dialogue.phase.kind === 'results') &&
    verbAction(text, [only]) === only
  ) {
    return start(only, route.fields, directory, dialogue, text);
  }
  // One action in doubt that changes or sends, asked for by its verb first: it is shown on a
  // confirm card before anything is done, so it is started rather than asked about. "Can you
  // invite a user?" asks for the email; "draft a message to the team" is still asked about.
  if (
    only &&
    route.actions.length === 1 &&
    (only.effect === 'change' || only.effect === 'send') &&
    (!dialogue || dialogue.phase.kind === 'results') &&
    asksFirst(text, only)
  ) {
    return forEveryone(only, route.fields[only.id] ?? {})
      ? { kind: 'ask_ai' }
      : start(only, route.fields, directory, dialogue, text);
  }
  const actions = route.actions
    .filter(({ id }) => id !== dialogue?.action.id)
    .slice(0, MAX_CHOICES);
  // Only the open action in doubt: that is as good as sure.
  if (dialogue && actions.length === 0) {
    return interpretRoute(context, text, { ...route, kind: 'actions' }, directory);
  }
  const unsure = { actions, fields: route.fields };
  return {
    kind: 'unsure',
    unsure,
    question: questionOf(unsure, dialogue),
    options: optionsOf(unsure, dialogue),
  };
}

// The card's values, and those Jev read that fit their field: "him" is no address, so the
// address on the card stays.
function withCard(
  action: ActionDefinition,
  card: Record<string, string> = {},
  read: Record<string, string> = {},
  directory: Directory,
): Record<string, string> {
  const fit = Object.entries(read).filter(([field, words]) => {
    const definition = action.fields[field];
    return definition && resolveField(definition, words, directory)?.kind !== 'none';
  });
  return { ...card, ...Object.fromEntries(fit) };
}

// People, channels and dates: the kinds a name or a date said alone may answer.
const familyOf = (kind: FieldKind | undefined): string | undefined =>
  kind === 'people'
    ? 'person'
    : kind === 'person' || kind === 'channel' || kind === 'date'
      ? kind
      : undefined;

// "Sarah Ayan." to "Who should I mention?", read by Jev as the person messaged: a single value of
// the asked field's kind is the answer to it, whichever field of that kind Jev put it in.
function toAsked(
  action: ActionDefinition,
  field: string | undefined,
  fields: Record<string, string>,
): Record<string, string> {
  const [only, ...more] = Object.entries(fields);
  if (!field || !only || more.length > 0 || only[0] === field) return fields;
  const asked = familyOf(action.fields[field]?.kind);
  return asked && asked === familyOf(action.fields[only[0]]?.kind) ? { [field]: only[1] } : fields;
}

// Off the open question: kept, until twice in a row, then put aside, so Ask AI can be asked. A
// list on screen is kept however often: the request is done, and only waits on a pick.
function miss(dialogue: EngineState): Decision {
  if (dialogue.phase.kind === 'results') return { kind: 'missed', state: dialogue };
  const misses = dialogue.misses + 1;
  if (misses < MAX_MISSES) return { kind: 'missed', state: { ...dialogue, misses } };
  return {
    kind: 'hold',
    text: `I've put “${dialogue.action.title}” on hold. Say continue to pick it up.`,
  };
}

/** What the text amounts to once Jev has read it. */
export function interpretRoute(
  context: InterpretContext,
  text: string,
  route: Route,
  directory: Directory,
): Decision {
  const said = text.trim();
  const { dialogue } = context;
  if (route.kind === 'no_access') {
    const { action } = route;
    return {
      kind: 'no_access',
      action,
      text: `You don't have access to ${lowerFirst(action.title)}. Ask a workspace admin.`,
    };
  }
  if (route.kind === 'actions') {
    const [first] = route.actions;
    if (
      first &&
      first.id !== dialogue?.action.id &&
      forEveryone(first, route.fields[first.id] ?? {})
    ) {
      return { kind: 'ask_ai' };
    }
    // Asked how: its page is opened and its steps said, and nothing is filled in.
    if (route.actions.length === 1 && first?.guide && HOW_TO.test(said)) {
      return { kind: 'show', actions: [first], how: true };
    }
    // An action the card offers, asked for in words ("add him to the organisation first"): the
    // card's option, with its values where Jev read none that fit.
    const onCard = first && context.unsure?.actions.find(({ id }) => id === first.id);
    if (route.actions.length === 1 && onCard && context.unsure) {
      const fields = withCard(
        onCard,
        context.unsure.fields[onCard.id],
        route.fields[onCard.id],
        directory,
      );
      return switchTo(dialogue, onCard, { [onCard.id]: fields }, directory, said);
    }
    if (route.actions.length === 1 && first) {
      return start(first, route.fields, directory, dialogue, said);
    }
    // Several are never shown as pills: by voice nobody could use them. The user is asked which.
    return askWhich(context, said, { ...route, kind: 'unsure' }, directory);
  }
  if (route.kind === 'unsure') return askWhich(context, said, route, directory);
  if (!dialogue) {
    // Buddy is working with the user, and they named something it does: they are asked, with the
    // likeliest action, rather than answered by Ask AI out of the blue.
    const likeliest =
      route.kind === 'ask_ai' && context.engaged ? verbAction(said, context.engaged) : undefined;
    if (!likeliest) return { kind: 'ask_ai' };
    const unsure = { actions: [likeliest], fields: {}, said };
    return {
      kind: 'unsure',
      unsure,
      question: questionOf(unsure, null),
      options: optionsOf(unsure, null),
    };
  }

  if (route.kind === 'answer') {
    // An answer to a list on screen is more words for the search; with none, it is for Ask AI.
    if (dialogue.phase.kind === 'results' && Object.keys(route.fields).length === 0) {
      return miss(dialogue);
    }
    // Jev calls it the answer but read no field from it: to a text question, the words as said.
    const written = Object.keys(route.fields).length === 0 ? verbatim(dialogue, said) : null;
    if (written) return { kind: 'event', state: dialogue, event: written };
    const field = openQuestion(dialogue)?.field;
    const read = toAsked(dialogue.action, field, route.fields);
    // A long answer keeps the user's words, as the model's reading trims the leading verbs; but
    // only when it read that field alone: "with Priya last week" read as the person is not the
    // topic, and with a mention read too, the message is Jev's span of it, not the whole sentence.
    const alone = Object.keys(read).length === 1;
    const values =
      field && alone && field in read && dialogue.action.fields[field]?.kind === 'longtext'
        ? { [field]: said }
        : read;
    return {
      kind: 'event',
      state: dialogue,
      event: fieldsEvent(dialogue.action, values, directory, said),
    };
  }
  // Jev is down or slow, or read no field in it: a short statement is the answer to a text
  // question, as said, when Jev judges it to be one. A Jev outage must not block questions, so
  // with nothing open they go on.
  const answering = route.kind === 'ask_ai' ? (route.answering ?? 0) : 0;
  const literal =
    route.kind === 'unavailable' || (isShortAnswer(said) && answering >= SHORT_ANSWER_FLOOR)
      ? verbatim(dialogue, said)
      : null;
  return literal ? { kind: 'event', state: dialogue, event: literal } : miss(dialogue);
}
