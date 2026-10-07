import { hasValue, type ActionDefinition } from '../actions/action';
import { startDialogue, type DialogueEvent, type EngineState } from './dialogue';
import { emailsIn } from './email';
import { messageSaid, peopleByLabel, withoutLeadingName } from './message';
import type { Decision } from './interpret';
import { isPlaceholder, resolveField, type Directory, type Resolution } from './resolve';

/** Whether an action is carried out through a dialogue rather than only opened. */
export const isOperable = (action: ActionDefinition): boolean =>
  Object.keys(action.fields).length > 0 || action.plan.some(step => step.op !== 'open_page');

/** The words said for each field, matched to the records they mean. */
export function fieldsEvent(
  action: ActionDefinition,
  values: Record<string, string>,
  directory: Directory,
  said?: string,
): DialogueEvent {
  // An address said aloud runs longer than the value Jev reads, so it is read from `said`.
  const addresses = said ? emailsIn(said) : [];
  // "the member" names no one yet: the field is asked for, plainly.
  const read = Object.fromEntries(
    Object.entries(values).filter(
      ([field, words]) =>
        !['person', 'people'].includes(action.fields[field]?.kind ?? '') || !isPlaceholder(words),
    ),
  );
  const email = Object.entries(action.fields).find(([, { parse }]) => parse === 'email')?.[0];
  if (email && addresses.length > 0) read[email] = addresses.join(', ');
  const resolutions: Record<string, Resolution> = {};
  for (const [field, words] of Object.entries(read)) {
    const definition = action.fields[field];
    const resolution =
      definition && hasValue(words) ? resolveField(definition, words, directory) : null;
    if (resolution) resolutions[field] = resolution;
  }
  const message = Object.entries(action.fields).find(([, { parse }]) => parse === 'message')?.[0];
  if (message && said && !hasValue(read[message])) {
    const find = (field: string, words: string): Resolution | null => {
      const definition = action.fields[field];
      return definition ? resolveField(definition, words, directory, true) : null;
    };
    for (const [field, { words, found }] of Object.entries(
      peopleByLabel(said, action, read, find),
    )) {
      read[field] = words;
      resolutions[field] = found;
    }
  }
  if (message && said) {
    const { [message]: words, ...others } = read;
    const people = Object.entries(others)
      .filter(([field]) => ['person', 'people'].includes(action.fields[field]?.kind ?? ''))
      .map(([field, value]) => ({ said: value, found: resolutions[field] }));
    const text = hasValue(words) ? words : messageSaid(said, action, others);
    if (text) read[message] = withoutLeadingName(text, people);
  }
  return { type: 'fields', values: read, resolutions };
}

// The field naming where the action is done, which the conversation on screen may fill.
const placeOf = (action: ActionDefinition): string | undefined =>
  Object.entries(action.fields).find(
    ([field, { kind, required }]) =>
      kind === 'channel' && (required || action.requireOneOf?.includes(field)),
  )?.[0];

/** Whether the conversation on screen is where the action goes, when no other is said. */
export const takesHere = (action: ActionDefinition): boolean => !!placeOf(action);

// An unsaid destination is the conversation on screen; the confirm card names it.
function withHere(
  action: ActionDefinition,
  values: Record<string, string>,
  { here }: Directory,
): Record<string, string> {
  const place = placeOf(action);
  const said = (action.requireOneOf ?? [place]).some(field => field && hasValue(values[field]));
  return place && here && !said ? { ...values, [place]: 'here' } : values;
}

/** A request started afresh with what was read for it. */
export const begin = (
  action: ActionDefinition,
  values: Record<string, string>,
  directory: Directory,
  said?: string,
): { state: EngineState; event: DialogueEvent } => ({
  state: startDialogue(action),
  event: fieldsEvent(action, withHere(action, values, directory), directory, said),
});

/** The action started with what was read for it, or the open one continued if it is the same. */
export function start(
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
  return { kind: 'event', ...begin(action, values, directory, said) };
}
