import { fillTemplate, hasValue, type ActionDefinition } from '../actions/action';
import type { Route } from '../router';
import type { EngineState } from './dialogue';
import type { Decision, InterpretContext } from './interpret';
import { nameWordsOf, replyTo, verbAction, type Option } from './quickReplies';
import type { Directory } from './resolve';
import { start } from './start';
import { listOf, lowerFirst } from './text';

// The "did you mean" card. `said`: the sentence it may hand to Ask AI; `offer`: "yes" takes it.
export interface Unsure {
  actions: ActionDefinition[]; // those that can be switched to
  fields: Record<string, Record<string, string>>;
  said?: string;
  offer?: boolean;
}

const KEEP = 'keep';
const ELSE = 'else';
const ASK_AI = 'ask_ai';
const TELL_ME = "Okay, tell me what you'd like to do.";

/** The card's options: switch or keep going while a request is open, else the actions. */
export const optionsOf = ({ actions, said }: Unsure, dialogue: EngineState | null): Option[] =>
  dialogue
    ? [
        ...actions.map(({ id, title }) => ({ id, label: `Switch to ${title}` })),
        { id: KEEP, label: `Keep going with ${dialogue.action.title}` },
      ]
    : [
        ...actions.map(({ id, title }) => ({ id, label: title })),
        said ? { id: ASK_AI, label: 'Ask Xyne AI' } : { id: ELSE, label: 'Something else' },
      ];

/** The card's question, as it was put. */
export function questionOf(unsure: Unsure, dialogue: EngineState | null): string {
  const [only] = unsure.actions;
  if (unsure.said && only) return `Do you want me to ${lowerFirst(only.title)}, or ask Xyne AI?`;
  return `Did you mean ${listOf(optionsOf(unsure, dialogue).map(({ label }) => label))}?`;
}

/** An action started from the card; the request it replaces waits aside for "continue". */
export function switchTo(
  dialogue: EngineState | null,
  action: ActionDefinition,
  fields: Record<string, Record<string, string>>,
  directory: Directory,
  said?: string,
): Decision {
  const started = start(action, fields, directory, null, said);
  return dialogue && started.kind === 'event' ? { ...started, aside: dialogue } : started;
}

/** What one option of the card comes to; null when it is not one of them. */
export function chosen(
  context: InterpretContext,
  optionId: string,
  directory: Directory,
): Decision | null {
  const { dialogue, unsure } = context;
  if (!unsure) return null;
  if (optionId === KEEP) {
    return dialogue ? { kind: 'event', state: dialogue, event: { type: 'resume' } } : null;
  }
  if (optionId === ELSE) return { kind: 'say', text: TELL_ME };
  if (optionId === ASK_AI && unsure.said) return { kind: 'ask_ai', text: unsure.said };
  const action = unsure.actions.find(({ id }) => id === optionId);
  if (!action) return null;
  // Offered for a sentence Jev read as Ask AI's, so nothing was read for it: it is read again.
  if (unsure.said && Object.keys(action.fields).length > 0) {
    return { kind: 'read', action, said: unsure.said, question: questionOf(unsure, dialogue) };
  }
  return switchTo(dialogue, action, unsure.fields, directory, unsure.said);
}

/** The card answered in words: an option's title or number, "continue", "no" or "cancel". */
export function answerCard(
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
  if (reply && typeof reply === 'object') return chosen(context, reply.option.id, directory);
  // "Yes, send it" to a card that asks which: the option it names.
  const named = !reply || reply === 'yes' ? namedOption(unsure, text) : undefined;
  return named ? chosen(context, named.id, directory) : null;
}

// Said around an option's name without adding to it: "yes send it", "the message one".
const AROUND_OPTION = new Set(
  'yes yeah yep ok okay sure please it that this the a an one do go ahead i want to just switch'.split(
    ' ',
  ),
);

// The card's action a reply names in its own words and nothing else: "send message", "message".
function namedOption(unsure: Unsure, text: string): ActionDefinition | undefined {
  const said = (text.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter(word => !AROUND_OPTION.has(word))
    .map(word => word.replace(/s$/, ''));
  if (said.length === 0) return undefined;
  const fits = unsure.actions.filter(action => {
    const names = nameWordsOf(action);
    return said.every(word => names.has(word));
  });
  return fits.length === 1 ? fits[0] : undefined;
}

/** The card's action a routed reply asks for: the only one on the card, or the one its verb names. */
export function cardActionOf(
  unsure: Unsure,
  routed: readonly ActionDefinition[],
  said: string,
): ActionDefinition | undefined {
  const onCard = routed.filter(action => unsure.actions.some(({ id }) => id === action.id));
  const [only] = onCard;
  if (onCard.length === 1 && only && (routed[0] === only || verbAction(said, [only]) === only)) {
    return only;
  }
  return onCard.length > 1 ? verbAction(said, onCard) : undefined;
}

const readFor = (action: ActionDefinition, route: Route): Record<string, string> => {
  if (route.kind === 'answer') return route.fields;
  if (route.kind === 'actions' || route.kind === 'unsure') return route.fields[action.id] ?? {};
  return {};
};

/** The card's action started with what Jev read for it alone, the reply's values, and here. */
export function interpretRead(
  { action, said, fields }: Extract<Decision, { kind: 'read' }>,
  route: Route,
  directory: Directory,
): Decision {
  // The reply only adds: the sentence the card was about is what is sent or done.
  const values = { ...fields, ...readFor(action, route) };
  return start(action, { [action.id]: values }, directory, null, said);
}

/** What a refused run offers next, as a card: the action its `onRefused` names. */
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
  return { text: fillTemplate(rule.say, state.values), unsure, options: optionsOf(unsure, state) };
}
