import {
  hasValue,
  type ActionDefinition,
  type FieldDefinition,
  type FieldValue,
} from '../actions/action';
import { emailResolution } from './email';
import { askedField, isYes } from './quickReplies';
import { groupOf, MAX_OPTIONS, type Resolution, type Resolved } from './resolve';
import { inResults, RESULTS_PROMPT } from './results';
import { clip, listOf, lower } from './text';

/**
 * Decides the next step of a request that takes several turns. Pure: no page, no network.
 * The form on screen is the source of truth, so what the user typed there counts as answered.
 * A dialogue ends by being dropped: when the run has finished, when it is cancelled, or when it is
 * left open to the user (`left_open`).
 */
export type Phase =
  | { kind: 'collecting'; field: string | null } // waiting for the answer to this field
  // Several records fit the words said; `guess`: none did, and these are offered as near ones.
  | { kind: 'choosing'; field: string; options: Resolved[]; guess?: boolean }
  | { kind: 'confirming'; fingerprint: string } // the values the user was shown
  | { kind: 'submitting' }
  // The run found a list, now on screen: the user picks from it, or narrows it. `start` is the
  // first item on the card.
  | { kind: 'results'; list: ShownResults; start: number };

// One result on screen, as the page names it: `label` is who or what it is ("Sarah Khan",
// "VAI-0041 Checkout 502s"), `group` where it is ("#onboarding"), `detail` shown but not spoken.
// None of them is ever a message's text, a snippet of it, or someone else's email, since they may
// be spoken aloud; and no list is ever sent to Jev.
export type ListItem = { id: string; label: string; detail?: string; group?: string };

// A list as the page showed it when it was read. `version` tells it from a newer one.
export interface ShownResults {
  kind: string;
  total: number;
  items: ListItem[];
  version: number;
}

export interface EngineState {
  action: ActionDefinition;
  values: Record<string, FieldValue>;
  offered: string[]; // optional fields already offered
  resolved: Record<string, Resolved>; // the record each person, channel or date field stands for
  unsettled: Record<string, Resolution>; // words that fit several records or none: asked, never run
  attempts: Record<string, number>; // how many times in a row each field has been asked
  misses: number; // replies in a row that were not about the open question
  phase: Phase;
  // The values before each narrowing of a list, for "go back".
  earlier?: { values: Record<string, FieldValue>; resolved: Record<string, Resolved> }[];
}

export type DialogueEvent =
  | { type: 'fields'; values: Record<string, string>; resolutions?: Record<string, Resolution> }
  | { type: 'chosen'; field: string; pick: Resolved }
  | { type: 'ask'; field: string } // "the name", while asking what to change
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'resume' } // "continue" after a detour
  | { type: 'cancel' }
  | { type: 'open'; item: ListItem } // one of the list on screen
  | { type: 'more' } // the next items of the list
  | { type: 'refine' } // "none of these": more detail is asked for
  | { type: 'back' }; // the list as it was before the last narrowing

export type Step =
  | { kind: 'ask'; field: string; prompt: string }
  // `options`: those offered; `more`: others fit too, so the prompt says how many and how to say which.
  // `guess`: the prompt already names the options ("Did you mean Sara Iyer?").
  | {
      kind: 'choose';
      field: string;
      prompt: string;
      options: Resolved[];
      more?: boolean;
      guess?: boolean;
    }
  | { kind: 'confirm'; summary: string }
  | { kind: 'run' }
  | { kind: 'revise' } // "no" to the confirmation: what to change is asked for
  | { kind: 'needed'; label: string } // "skip" to a field the request cannot do without
  | { kind: 'left_open'; form: boolean } // the question did not get through: left to the user
  | { kind: 'cancelled' }
  | { kind: 'busy' }
  // What is said of the list on screen, the items on the card, and the one to open now.
  | { kind: 'results'; prompt: string; options: ListItem[]; open?: ListItem }
  | { kind: 'dismissed' }; // "cancel" with a list on screen: nothing was running

type Values = Record<string, FieldValue>;

const everyone = (pick: Resolved): Resolved[] => pick.group ?? [pick];

// "Sara Iyer and Elena Petrov" and the DM "Sara Iyer, Elena Petrov" are the same people.
const namesOf = (label: string): string =>
  label
    .split(/\s*,\s*|\s+and\s+/)
    .map(lower)
    .sort()
    .join('|');
const sameNames = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && namesOf(a) === namesOf(b);

const REVISE_PROMPT = 'What should I change?';
// The third time the same question is asked, the user is better served by the form itself.
const MAX_ATTEMPTS = 3;

export const startDialogue = (action: ActionDefinition): EngineState => ({
  action,
  values: {},
  offered: [],
  resolved: {},
  unsettled: {},
  attempts: {},
  misses: 0,
  phase: { kind: 'collecting', field: null },
});

// What asks for a message rather than being part of it: "and say, “…”", "saying …", "ask them
// to …". A lowercase "that" too ("that lunch is here"); "That was quick" is the message itself.
const MESSAGE_LEAD =
  /^(?:(?:and|then)\s+)?(?:say|saying|tell (?:them|him|her)|ask (?:them|him|her)(?: to)?)\b[\s,:]*/i;
const wordsToSend = (words: string): string => {
  let rest = words.trim();
  for (let before = ''; before !== rest; ) {
    before = rest;
    rest = rest
      .replace(MESSAGE_LEAD, '')
      .replace(/^that\s+/, '')
      // Quotes around it, or the one a cut span leaves: “Can you do RCA
      .replace(/^["“‘']\s*|\s*["”’']$/g, '')
      .trim();
  }
  return rest || words.trim();
};

// The ids too, so "yes" never runs with another person than the one shown.
const fingerprintOf = (
  action: ActionDefinition,
  values: Values,
  resolved: Record<string, Resolved>,
): string =>
  JSON.stringify(
    Object.keys(action.fields).map(field => [values[field] ?? null, resolved[field]?.id ?? null]),
  );

// Everything that will be done is on the card: a boolean that is on reads as its label.
const summaryOf = (action: ActionDefinition, values: Values): string => {
  if (action.summary) return action.summary(values);
  const parts = Object.entries(action.fields).flatMap(([field, { kind, label }]) => {
    const value = values[field];
    if (!hasValue(value)) return [];
    return [kind === 'boolean' ? label : `${label} “${clip(value.trim())}”`];
  });
  return parts.length > 0 ? `${action.title} with ${parts.join(', ')}` : action.title;
};

const confirmation = (summary: string): string => `${summary}. Go ahead?`;

// "Which Deepanshu?": the words as said are still the field's value while the choice is open.
// Several email addresses are taken one at a time. Near ones, offered for words that fit no one,
// are asked about by name: "Did you mean Sara Iyer?".
const chooseQuestion = (
  words: FieldValue | undefined,
  definition: FieldDefinition | undefined,
  guessed?: readonly Resolved[],
): string => {
  if (guessed) return `Did you mean ${listOf(guessed.map(({ label }) => label))}?`;
  return definition?.parse === 'email'
    ? 'One at a time: which first?'
    : `Which ${words?.trim() ?? 'one'}?`;
};

export const replyFor = (step: Step): string => {
  switch (step.kind) {
    case 'ask':
      return step.prompt;
    case 'choose':
      return step.more || step.guess
        ? step.prompt
        : `${step.prompt} ${listOf(step.options.map(option => option.label))}?`;
    case 'confirm':
      return confirmation(step.summary);
    case 'run':
      return 'On it…';
    case 'revise':
      return `Okay. ${REVISE_PROMPT}`;
    case 'needed':
      return `I need the ${step.label} to go on. Tell me, or say cancel.`;
    case 'left_open':
      return step.form
        ? "I've left the form open so you can finish it there."
        : "Let's leave it there. Ask me again when you're ready.";
    case 'cancelled':
      return 'Okay, I won’t do that.';
    case 'busy':
      return 'Already on it.';
    case 'results':
      return step.prompt;
    case 'dismissed':
      return 'Okay.';
  }
};

// What "cancel" is answered while the run is under way: it is stopped only if nothing was sent yet.
export const STOPPED = 'Stopped. Nothing was submitted.';
export const ALREADY_SENT = "That was already sent; I can't undo it.";

// The card's way to say none of these, beside the items.
export const TELL_ME_MORE = { id: 'tell_me_more', label: 'Tell me more' } as const;
// A pick from a list the page no longer shows.
export const LIST_GONE =
  "That list isn't on screen any more. Say what to search for and I'll find it again.";
// The card's way to say it is none of those offered, when more fit than were offered.
export const SOMEONE_ELSE = { id: 'someone_else', label: 'Someone else' } as const;
// How to say which of more people or channels than were offered.
const NARROW_PERSON = 'Say their surname or email.';
const NARROW_CHANNEL = 'Say more of its name.';

// The likeliest next replies whatever the action, which voice mode synthesizes ahead of time; any
// other is synthesized when said, so a claim of voice mode costs few /tts calls.
export const LIKELY_REPLIES: readonly string[] = (
  [{ kind: 'run' }, { kind: 'revise' }, { kind: 'cancelled' }, { kind: 'busy' }] as const
).map(step => replyFor(step));

// The dialogue is over: cancelled, left to the user's own hands, or an item of its list opened.
// What is open is then what the next request is about; the list stays on screen to pick again.
export const endsDialogue = (step: Step): boolean =>
  step.kind === 'cancelled' ||
  step.kind === 'left_open' ||
  step.kind === 'dismissed' ||
  (step.kind === 'results' && !!step.open);

// A run that failed for no field of its own is asked about again: "yes" runs what was shown.
export const retryable = (state: EngineState): EngineState => ({
  ...state,
  phase: {
    kind: 'confirming',
    fingerprint: fingerprintOf(state.action, state.values, state.resolved),
  },
});

/**
 * The question the user was last put and may be answering, as it was put to them; null while a
 * run is under way. `field` is absent when it is about the whole request.
 */
export function openQuestion(state: EngineState): { field?: string; prompt: string } | null {
  const { action, values, offered, phase } = state;
  switch (phase.kind) {
    case 'collecting': {
      const { field } = phase;
      if (!field) return { prompt: REVISE_PROMPT };
      const definition = action.fields[field];
      const prompt =
        (definition?.offer && offered.includes(field) ? definition.offer : definition?.ask) ?? '';
      return { field, prompt };
    }
    case 'choosing':
      return {
        field: phase.field,
        prompt: chooseQuestion(
          values[phase.field],
          action.fields[phase.field],
          phase.guess ? phase.options.slice(0, MAX_OPTIONS) : undefined,
        ),
      };
    case 'confirming':
      return { prompt: confirmation(summaryOf(action, values)) };
    case 'submitting':
      return null;
    case 'results':
      return { prompt: RESULTS_PROMPT };
  }
}

export type Advance = { state: EngineState; step: Step };

// Puts the question of a field, which then waits for its answer.
const ask = (
  state: EngineState,
  field: string,
  prompt: string,
  offered = state.offered,
): Advance => ({
  state: { ...state, offered, phase: { kind: 'collecting', field } },
  step: { kind: 'ask', field, prompt },
});

function nextStep(state: EngineState): Advance {
  const { action, values, offered, resolved, unsettled } = state;
  const fields = Object.entries(action.fields);

  // Words that fit several records, or none, are never run with: they are asked about, one field
  // at a time, until each is settled.
  const open = fields.find(([field]) => unsettled[field]);
  if (open) {
    const [field, definition] = open;
    const resolution = unsettled[field];
    if (resolution?.kind === 'many') {
      const { options, named } = resolution;
      const offered = options.slice(0, MAX_OPTIONS);
      // More than can be offered: how many is said, and the user says which, never left out.
      const more = definition.parse !== 'email' && options.length > offered.length;
      const guess = !more && resolution.guess === true;
      const words = (named ?? values[field] ?? '').trim().replace(/^@/, '');
      const prompt = !more
        ? chooseQuestion(named ?? values[field], definition, guess ? options : undefined)
        : definition.kind === 'channel'
          ? `${options.length} channels match “${words}”. Which one? ${NARROW_CHANNEL}`
          : `There are ${options.length} people named ${words}. Which one? ${NARROW_PERSON}`;
      return {
        state: { ...state, phase: { kind: 'choosing', field, options, ...(guess && { guess }) } },
        step: {
          kind: 'choose',
          field,
          prompt,
          options: more ? offered : options,
          ...(more && { more }),
          ...(guess && { guess }),
        },
      };
    }
    if (resolution?.kind === 'some') {
      const missing = listOf(resolution.missing.map(name => `“${name}”`));
      return ask(state, field, `I couldn't find ${missing}. Who else, or say that's all?`);
    }
    const words = values[field]?.trim() ?? '';
    const why =
      definition.parse === 'email'
        ? `“${words}” isn't an email address.`
        : `I couldn't find “${words}”.`;
    return ask(state, field, `${why} ${definition.ask}`);
  }

  // Where it goes may be said in more than one way, so no one field is required: one must be given.
  const oneOf = action.requireOneOf ?? [];
  const [target] = oneOf;
  if (target && !oneOf.some(field => hasValue(values[field]))) {
    return ask(state, target, action.fields[target]?.ask ?? '');
  }
  const missing = fields.find(([field, { required }]) => required && !hasValue(values[field]));
  if (missing) return ask(state, missing[0], missing[1].ask);
  // A bare request is asked about once, rather than run with nothing; "skip" then runs it. A page
  // opened with nothing is what was asked: "show me the agents" shows them all.
  const [first] = fields;
  if (
    first &&
    action.effect !== 'navigate' &&
    !fields.some(([f]) => hasValue(values[f])) &&
    !offered.includes(first[0])
  ) {
    return ask(state, first[0], first[1].ask, [...offered, first[0]]);
  }
  const offer = fields.find(
    ([field, { offer }]) => offer && !hasValue(values[field]) && !offered.includes(field),
  );
  if (offer) return ask(state, offer[0], offer[1].offer ?? offer[1].ask, [...offered, offer[0]]);

  // A request for several people at once is always shown first, naming each of them.
  if (
    action.effect === 'send' ||
    action.effect === 'change' ||
    Object.values(resolved).some(pick => pick.group)
  ) {
    const fingerprint = fingerprintOf(action, values, resolved);
    return {
      state: { ...state, phase: { kind: 'confirming', fingerprint } },
      step: { kind: 'confirm', summary: summaryOf(action, values) },
    };
  }
  return { state: { ...state, phase: { kind: 'submitting' } }, step: { kind: 'run' } };
}

/** The choice or confirmation open, put again as it was: for a reply that did not get through. */
export const putAgain = (state: EngineState): string => replyFor(nextStep(state).step);

// The same question put twice in a row means the answer did not get through: it is said so, with
// the choices when there are any, and the third time the form is left to the user.
// A choice narrowed to fewer is a new question.
const questionOf = (phase: Phase): string =>
  `${phase.kind}:${askedField(phase) ?? ''}:${phase.kind === 'choosing' ? phase.options.length : ''}`;

// `heard`: the words just said for each field, when they differ from those before. A choice put
// again for other words ("Sarah Pyer" after "Sara Ayan", offered the same near names) is a new
// question: the answer got through.
function escalate(
  before: EngineState,
  { state, step }: Advance,
  heard: Record<string, string> = {},
): Advance {
  if (step.kind !== 'ask' && step.kind !== 'choose') return { state, step };
  const { field } = step;
  const again =
    questionOf(before.phase) === questionOf(state.phase) &&
    !(step.kind === 'choose' && hasValue(heard[field]));
  const attempt = again ? (before.attempts[field] ?? 1) + 1 : 1;
  const counted = { ...state, attempts: { ...state.attempts, [field]: attempt } };
  if (attempt >= MAX_ATTEMPTS) {
    const form = state.action.plan.some(planned => planned.op === 'fill');
    return { state: counted, step: { kind: 'left_open', form } };
  }
  // "I couldn't find…" already says why the question is asked again.
  const unfound = state.unsettled[field]?.kind;
  if (attempt === 1 || unfound === 'none' || unfound === 'some') return { state: counted, step };
  const options = state.action.fields[field]?.options;
  const choices = step.kind === 'ask' && options ? ` ${listOf(options.map(o => o.label))}?` : '';
  return {
    state: counted,
    step: { ...step, prompt: `Sorry, I didn't catch that. ${step.prompt}${choices}` },
  };
}

/**
 * Records what each said value stands for. One that fits a single record is kept by id and shown
 * by its name. Several are kept as unsettled, with the words as said: they are asked about rather
 * than guessed at, since the wrong person in a filter is worse than a question, even for an
 * optional field. A person or channel that fits none is asked about too, since running without it
 * would search or send to everyone. Any other words that fit none are asked about only when they
 * answer the open question; anywhere else they are noise: dropped, and a required field is then
 * asked as missing.
 */
function settle(
  state: EngineState,
  said: Record<string, string>,
  resolutions: Record<string, Resolution> = {},
): EngineState {
  const values = { ...state.values };
  const resolved = { ...state.resolved };
  const unsettled = { ...state.unsettled };
  const asking = askedField(state.phase);
  for (const field of Object.keys(state.action.fields)) {
    const words = said[field];
    if (!hasValue(words)) continue;
    // New words: what the old ones were resolved to no longer holds, but for those of a list
    // found before, to which they add the people still to be named.
    const before = unsettled[field];
    delete resolved[field];
    delete unsettled[field];
    const { kind, parse } = state.action.fields[field] ?? {};
    // An address taken as said (Jev was not asked) is still read as one.
    const heard = resolutions[field] ?? (parse === 'email' ? emailResolution(words) : undefined);
    const resolution =
      before?.kind === 'some' && heard?.kind === 'one'
        ? { kind: 'one' as const, pick: groupOf([before.pick, heard.pick].flatMap(everyone)) }
        : heard;
    // An address that cannot be read is asked for again, never left to an earlier one or the form's.
    const named = kind === 'person' || kind === 'people' || kind === 'channel' || parse === 'email';
    if (resolution?.kind === 'one') {
      resolved[field] = resolution.pick;
      values[field] = resolution.pick.label;
    } else if (resolution?.kind === 'many' || (resolution && (named || field === asking))) {
      unsettled[field] = resolution;
    } else if (resolution) {
      values[field] = null;
    }
  }
  // Alternatives ("a person or a channel"): words that only name again the one found ("Priya" read
  // as a channel too) are dropped. Any other words are asked about, so the card never names one
  // target while the request goes to another.
  const oneOf = state.action.requireOneOf ?? [];
  const found = oneOf.flatMap(field => {
    const pick = resolved[field];
    return pick ? [` ${lower(pick.label)} `] : [];
  });
  for (const field of oneOf) {
    const words = values[field];
    const again = hasValue(words) && found.some(label => label.includes(` ${lower(words)} `));
    if (unsettled[field] && again) {
      delete unsettled[field];
      values[field] = null;
    }
  }
  // The same words found as a channel and as someone ("design", and a person called Design) name
  // one place, not a place and a person to mention there: the channel is kept. So do the people
  // of a DM and the DM itself.
  const place = oneOf.find(
    field => state.action.fields[field]?.kind === 'channel' && resolved[field],
  );
  const placeWords = place ? lower(said[place] ?? '') : '';
  for (const field of oneOf) {
    if (
      place &&
      field !== place &&
      resolved[field] &&
      ((placeWords && lower(said[field] ?? '') === placeWords) ||
        sameNames(resolved[field]?.label, resolved[place]?.label))
    ) {
      delete resolved[field];
      values[field] = null;
    }
  }
  return { ...state, values, resolved, unsettled };
}

/** Takes the user's event and says what happens next; `read` is what the form on screen holds. */
export function advance(
  state: EngineState,
  event: DialogueEvent,
  read: (field: string) => FieldValue,
): Advance {
  const result = advanceOnce(state, event, read);
  // Whatever the user said was about the dialogue, so the replies that were not are forgotten.
  return { ...result, state: { ...result.state, misses: 0 } };
}

function advanceOnce(
  state: EngineState,
  event: DialogueEvent,
  read: (field: string) => FieldValue,
): Advance {
  const { action, phase } = state;
  if (phase.kind === 'submitting') return { state, step: { kind: 'busy' } };
  if (phase.kind === 'results' && event.type !== 'fields') return inResults(state, phase, event);
  if (event.type === 'cancel') return { state, step: { kind: 'cancelled' } };
  // "Continue": the open question is put again, as it was.
  if (event.type === 'resume') {
    if (phase.kind === 'confirming') {
      return { state, step: { kind: 'confirm', summary: summaryOf(action, state.values) } };
    }
    if (Object.keys(state.unsettled).length > 0) return nextStep(state);
    const question = openQuestion(state);
    return {
      state,
      step: question?.field
        ? { kind: 'ask', field: question.field, prompt: question.prompt }
        : { kind: 'revise' },
    };
  }

  // "Someone else", of more than were offered: the user is asked to say which, among them all.
  if (event.type === 'refine' && phase.kind === 'choosing') {
    const narrow = action.fields[phase.field]?.kind === 'channel' ? NARROW_CHANNEL : NARROW_PERSON;
    return { state, step: { kind: 'ask', field: phase.field, prompt: narrow } };
  }
  // "The name", while asking what to change: that field is asked.
  if (event.type === 'ask') {
    return ask(state, event.field, action.fields[event.field]?.ask ?? '');
  }
  const asking = askedField(phase);
  const definition = asking ? action.fields[asking] : undefined;
  // "Skip" to a field the request cannot do without: it is said what is needed.
  // "That's all" to the names not found: the people found are the ones meant.
  const partly = asking ? state.unsettled[asking] : undefined;
  if (event.type === 'no' && asking && partly?.kind === 'some') {
    const { [asking]: _settled, ...unsettled } = state.unsettled;
    const values = { ...state.values, [asking]: partly.pick.label };
    const resolved = { ...state.resolved, [asking]: partly.pick };
    return escalate(state, nextStep({ ...state, values, resolved, unsettled }));
  }
  if (event.type === 'no' && definition?.required) {
    return { state, step: { kind: 'needed', label: definition.label } };
  }
  // "Yes" to the offer of anything but a boolean: its question is asked.
  if (
    event.type === 'yes' &&
    phase.kind === 'collecting' &&
    asking &&
    definition &&
    definition.kind !== 'boolean'
  ) {
    return ask(state, asking, definition.ask);
  }

  // "Yes" to the offer of a boolean field is its value.
  const offered = phase.kind === 'collecting' ? phase.field : null;
  const said: Record<string, string> =
    event.type === 'fields'
      ? event.values
      : event.type === 'chosen'
        ? { [event.field]: event.pick.label }
        : event.type === 'yes' && offered && action.fields[offered]?.kind === 'boolean'
          ? { [offered]: 'yes' }
          : {};
  const resolutions: Record<string, Resolution> | undefined =
    event.type === 'fields'
      ? event.resolutions
      : event.type === 'chosen'
        ? { [event.field]: { kind: 'one', pick: event.pick } }
        : undefined;
  // What was just said wins, then the form, then what was said earlier, then the default.
  const values = Object.fromEntries(
    Object.entries(action.fields).map(([field, definition]) => {
      const heardWords = said[field];
      const spoken =
        definition.parse === 'message' && heardWords !== undefined
          ? wordsToSend(heardWords)
          : heardWords;
      if (definition.kind === 'boolean' && spoken !== undefined) {
        return [field, isYes(spoken) ? 'true' : null];
      }
      const value = [spoken, read(field), state.values[field], definition.default].find(hasValue);
      return [field, value ?? null];
    }),
  );
  // A boolean answered unasked is not offered again.
  const answered = Object.keys(said).filter(
    field => action.fields[field]?.kind === 'boolean' && !state.offered.includes(field),
  );
  // "No" to words that matched several records or none leaves that field out, rather than asking
  // it again.
  const unsettled = { ...state.unsettled };
  if (event.type === 'no' && asking && unsettled[asking]) {
    delete unsettled[asking];
    values[asking] = null;
  }
  const next = settle(
    { ...state, values, unsettled, offered: [...state.offered, ...answered] },
    said,
    resolutions,
  );
  const heard = Object.fromEntries(
    Object.entries(said).filter(
      ([field, words]) => lower(words) !== lower(state.values[field] ?? ''),
    ),
  );

  // More words for the search narrow it, and are run again; the same words put the question again.
  if (phase.kind === 'results') {
    const unchanged =
      fingerprintOf(action, next.values, next.resolved) ===
        fingerprintOf(action, state.values, state.resolved) &&
      Object.keys(next.unsettled).length === 0;
    if (unchanged) return inResults(state, phase, { type: 'resume' });
    const before = { values: state.values, resolved: state.resolved };
    return escalate(
      next,
      nextStep({ ...next, earlier: [...(state.earlier ?? []), before] }),
      heard,
    );
  }
  if (phase.kind === 'confirming') {
    if (event.type === 'no') {
      return {
        state: { ...next, phase: { kind: 'collecting', field: null } },
        step: { kind: 'revise' },
      };
    }
    // "Yes" runs only what was shown; if the values changed since, they are shown again.
    if (
      event.type === 'yes' &&
      phase.fingerprint === fingerprintOf(action, values, next.resolved)
    ) {
      return { state: { ...next, phase: { kind: 'submitting' } }, step: { kind: 'run' } };
    }
  }
  return escalate(next, nextStep(next), heard);
}
