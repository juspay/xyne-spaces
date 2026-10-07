import { hasValue, type ActionDefinition, type FieldDefinition } from '../actions/action';
import type { Route } from '../router';
import { emailsIn } from './email';
import { listOf, lower, lowerFirst } from './text';

/**
 * Several requests in one sentence ("create a channel Xyne ABC and add Daniel to it"), done one
 * after another, each confirmed on its own card. Pure: it says which steps there are and in what
 * order; the session keeps the ones still to come.
 */

// A step still to come. Jev's words, resolved only when the step starts: "it" is then what the
// step before it made.
export interface QueuedStep {
  action: ActionDefinition;
  fields: Record<string, string>;
  said: string;
}

const MAX_STEPS = 3;

/** Whether the action is shown on a confirm card before it is done. */
export const confirms = ({ effect }: ActionDefinition): boolean =>
  effect === 'send' || effect === 'change';

// Words that cannot be the field's hold nothing: "Sara" read as an email address.
const fits = (definition: FieldDefinition | undefined, words: string): boolean =>
  hasValue(words) && (definition?.parse !== 'email' || emailsIn(words).length > 0);

const stepOf = (
  route: Extract<Route, { kind: 'actions' }>,
  action: ActionDefinition,
  said: string,
): QueuedStep => ({
  action,
  fields: Object.fromEntries(
    Object.entries(route.fields[action.id] ?? {}).filter(([field, words]) =>
      fits(action.fields[field], words),
    ),
  ),
  said,
});

// Read a value for a field `other` has not: it holds words of the sentence `other` cannot take.
const holdsMore = (step: QueuedStep, other: ActionDefinition): boolean =>
  Object.keys(step.fields).some(field => !(field in other.fields));

// Where the words are said as words of their own: "it" is not the one in "with".
const indexOfWords = (said: string, words: string): number => {
  const escaped = lower(words).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return lower(said).search(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`));
};

// Where the step is first said; one whose words are not in the sentence comes last.
const placeOf = ({ fields, said }: QueuedStep): number => {
  const found = Object.values(fields)
    .map(words => indexOfWords(said, words))
    .filter(at => at >= 0);
  return found.length > 0 ? Math.min(...found) : said.length;
};

/**
 * The steps of a sentence Jev read as several actions, in the order said; null when it is not
 * several requests. Each must hold words the others cannot take, or one action merely covers
 * another: "start a chat with Sarah and say hello" is one message.
 */
export function chainOf(
  route: Route,
  said: string,
): { first: QueuedStep; rest: QueuedStep[] } | null {
  if (route.kind !== 'actions' || route.actions.length < 2 || route.actions.length > MAX_STEPS) {
    return null;
  }
  const steps = route.actions.map(action => stepOf(route, action, said));
  const apart = steps.every(step =>
    steps.every(other => other === step || holdsMore(step, other.action)),
  );
  // A stable sort: steps said at the same place keep Jev's order.
  const [first, ...rest] = [...steps].sort((a, b) => placeOf(a) - placeOf(b));
  return first && apart && steps.every(({ action }) => confirms(action)) ? { first, rest } : null;
}

// A step as said back: its summary once it has what that needs, else its title.
const nameOf = ({ action, fields }: QueuedStep): string => {
  const complete = Object.entries(action.fields).every(
    ([field, { required }]) => !required || hasValue(fields[field]),
  );
  return lowerFirst(complete && action.summary ? action.summary(fields) : action.title);
};

/** The steps let go of, said once; '' when there were none. */
export const droppedText = (steps: readonly QueuedStep[]): string =>
  steps.length > 0 ? `I've dropped ${listOf(steps.map(nameOf), 'and')}.` : '';

/** The outcome of a step and the next one's question, in one breath. */
export const nextAfter = (done: string, reply: string): string =>
  `${done} Next: ${lowerFirst(reply)}`;
