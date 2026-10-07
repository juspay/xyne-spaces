import { hasValue, type ActionDefinition, type FieldKind } from '../actions/action';
import { ACTIONS } from '../catalog';
import type { Route } from '../router';
import {
  openQuestion,
  putAgain,
  SOMEONE_ELSE,
  TELL_ME_MORE,
  type DialogueEvent,
  type EngineState,
  type ListItem,
  type ShownResults,
} from './dialogue';
import { chainOf, confirms, type QueuedStep } from './chain';
import { narrowing } from './narrowing';
import {
  asksAgain,
  isHesitation,
  isQuestion,
  isShortAnswer,
  itemAt,
  quickEvent,
  quickWord,
  replyTo,
  startsRequest,
  verbAction,
  verbatim,
  withoutLead,
  type Option,
} from './quickReplies';
import { holdsSecret, NO_SECRETS } from './secrets';
import { fieldsEvent, start, takesHere } from './start';
import { isEveryone, resolveField, type Directory, type Resolution } from './resolve';
import { lowerFirst } from './text';
import {
  answerCard,
  cardActionOf,
  chosen,
  optionsOf,
  questionOf,
  switchTo,
  type Unsure,
} from './unsureCard';

/**
 * Decides what a sentence amounts to, before Jev is asked and after. Pure: no page, no store, no
 * network. It never acts; it says what should happen, and the caller does it.
 */

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
  // waits to be picked up with "continue". `queue`: the steps of the sentence still to come.
  | {
      kind: 'event';
      state: EngineState;
      event: DialogueEvent;
      aside?: EngineState;
      queue?: QueuedStep[];
    }
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
  // `fields`: what the reply that picked it said besides ("send a message to Sara").
  | {
      kind: 'read';
      action: ActionDefinition;
      said: string;
      question: string;
      fields?: Record<string, string>;
    }
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

const TAKE_YOUR_TIME = 'Take your time.';
const NOT_CAUGHT = "Sorry, I didn't catch that.";

// A few words that speech to text cut off: "What are you-", "so the…".
const MAX_CUT_OFF_WORDS = 3;
const isCutOff = (said: string): boolean =>
  /(?:[-–—…]|\.\.\.)$/.test(said) && said.split(/\s+/).length <= MAX_CUT_OFF_WORDS;

// "How do I…", "where can I…", "…kaise": a question about how to do it, not a request to.
// "Where did we talk about…" is a search, so only "where" with "can", "do" or "should I" counts.
const HOW_TO =
  /\b(?:how (?:do|can|could|would|should) (?:i|we|you)|how to|where (?:do|can|could|should) (?:i|we)|kaise)\b/i;

// Whether the sentence starts by asking for this action by its verb: "Can you invite a user?".
const asksFirst = (text: string, action: ActionDefinition): boolean => {
  const [first = ''] = withoutLead(text).split(/\s+/);
  return verbAction(first, [action]) === action;
};

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

// The most words a name said at the start of a message may have: "Sara Iyer".
const MAX_NAME_WORDS = 3;

// A name the message starts with, for an optional person field still empty (the mention): "Sara
// Iyer can do RCA". Only one person found exactly by those words.
function leadingPerson(
  { action, values }: EngineState,
  text: string,
  directory: Directory,
): { field: string; words: string; found: Resolution } | null {
  const field = Object.entries(action.fields).find(
    ([id, { kind, required }]) =>
      kind === 'person' && !required && !action.requireOneOf?.includes(id) && !hasValue(values[id]),
  )?.[0];
  const definition = field ? action.fields[field] : undefined;
  if (!field || !definition) return null;
  const words = text.trim().split(/\s+/);
  for (let count = Math.min(MAX_NAME_WORDS, words.length - 1); count > 0; count -= 1) {
    const name = words
      .slice(0, count)
      .join(' ')
      .replace(/[,.:;!?]+$/, '');
    const found = resolveField(definition, name, directory, true);
    if (found?.kind === 'one') return { field, words: name, found };
  }
  return null;
}

// The reply to a question whose answer is the user's own words (the message) is that answer, as
// said; a request of its own or a cut-off fragment is not.
function contentAnswer(
  dialogue: EngineState,
  text: string,
  directory: Directory,
): DialogueEvent | null {
  const field = dialogue.phase.kind === 'collecting' ? dialogue.phase.field : null;
  const definition = field ? dialogue.action.fields[field] : undefined;
  if (!field || !definition?.content) return null;
  if (startsRequest(text) || isCutOff(text.trim())) return null;
  // A message may ask something; what an agent does or a description never does.
  if (definition.parse !== 'message' && isQuestion(text)) return null;
  const person = leadingPerson(dialogue, text, directory);
  if (!person) return { type: 'fields', values: { [field]: text.trim() } };
  const message = text
    .trim()
    .slice(person.words.length)
    .replace(/^[\s,.:;!?]+/, '');
  return {
    type: 'fields',
    values: { [field]: message, [person.field]: person.words },
    resolutions: { [person.field]: person.found },
  };
}

function withDialogue(dialogue: EngineState, text: string, directory: Directory): Decision | null {
  const quick = quickEvent(dialogue, text);
  if (quick) return { kind: 'event', state: dialogue, event: quick };
  const content = contentAnswer(dialogue, text, directory);
  if (content) return { kind: 'event', state: dialogue, event: content };
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
  if (asksAgain(said)) {
    if (dialogue && dialogue.phase.kind !== 'results')
      return { kind: 'wait', text: putAgain(dialogue) };
    if (unsure) return { kind: 'wait', text: questionOf(unsure, dialogue) };
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

// A reply to the card that asks for one of its actions ("add him to the organisation first")
// picks it, with the card's values where Jev read none that fit. One offered for a sentence Jev
// read nothing from has that sentence read again, with what the reply adds.
function pickedOnCard(
  { dialogue, unsure }: InterpretContext,
  said: string,
  route: Extract<Route, { kind: 'actions' | 'unsure' }>,
  directory: Directory,
): Decision | null {
  const onCard = unsure && cardActionOf(unsure, route.actions, said);
  if (!unsure || !onCard) return null;
  const read = route.fields[onCard.id] ?? {};
  if (unsure.said && Object.keys(onCard.fields).length > 0) {
    const question = questionOf(unsure, dialogue);
    return { kind: 'read', action: onCard, said: unsure.said, question, fields: read };
  }
  const fields = withCard(onCard, unsure.fields[onCard.id], read, directory);
  return switchTo(dialogue, onCard, { [onCard.id]: fields }, directory, said);
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
    const picked = pickedOnCard(context, said, route, directory);
    if (picked) return picked;
    if (route.actions.length === 1 && first) {
      return start(first, route.fields, directory, dialogue, said);
    }
    // Several requests in one sentence: the first is started, and the rest wait their turn.
    const chain = chainOf(route, said);
    if (chain) {
      const { action, fields } = chain.first;
      const started = start(action, { [action.id]: fields }, directory, dialogue, said);
      return started.kind === 'event' ? { ...started, queue: chain.rest } : started;
    }
    // Several are never shown as pills: by voice nobody could use them. The user is asked which.
    return askWhich(context, said, { ...route, kind: 'unsure' }, directory);
  }
  if (route.kind === 'unsure') {
    return (
      pickedOnCard(context, said, route, directory) ?? askWhich(context, said, route, directory)
    );
  }
  if (!dialogue) {
    // Buddy is working with the user, and they named something it does: they are asked, with the
    // likeliest action, rather than answered by Ask AI out of the blue.
    const likeliest =
      route.kind === 'ask_ai' && context.engaged ? verbAction(said, context.engaged) : undefined;
    if (!likeliest) return { kind: 'ask_ai' };
    const unsure = { actions: [likeliest], fields: {}, said };
    // Something to send or change right where the user is: read for it at once, as its confirm
    // card asks before anything is done.
    if (directory.here && confirms(likeliest) && takesHere(likeliest)) {
      return { kind: 'read', action: likeliest, said, question: questionOf(unsure, null) };
    }
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
