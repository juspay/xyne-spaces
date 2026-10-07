import type { FormId } from '../forms/operableForm';
import type { PageId } from '../pages';
import type { TaskId } from '../tasks';
import type { RouteAction } from '../../../services/assistantRouteService';

export type Effect = 'read' | 'navigate' | 'send' | 'change';

export type FieldKind =
  | 'text'
  | 'longtext'
  | 'boolean'
  | 'choice'
  | 'person'
  | 'people'
  | 'channel'
  | 'date';

// Text for every kind; a boolean is 'true' or absent.
export type FieldValue = string | null;

export interface FieldDefinition {
  kind: FieldKind;
  required?: boolean;
  default?: string; // taken as the answer: not asked, unless the user says otherwise
  ask: string; // the question, spoken and shown
  label: string; // how it reads on the confirm card: "name", or for a boolean what it means when on
  offer?: string; // asked once for an optional field
  describe: string; // what the field means, for Jev
  options?: readonly { id: string; label: string }[];
  // How the words are read. 'email': an address, typed or said aloud ("vinit dot khandal at
  // juspay dot in"), read on the client since Jev reads every text field as the words said.
  // 'message': the words to send, without what asks for them ("say", "ask them to").
  parse?: 'email' | 'message';
}

type IntentDefinition = {
  description: string;
  examples: readonly string[];
  notFor?: readonly { when: string; instead: string }[];
};

export type PlanStep = (
  | { op: 'open_page'; page: PageId; params?: Readonly<Record<string, string>> } // values are templates
  | { op: 'fill'; form: FormId }
  | { op: 'run_action'; form: FormId; action: string }
  | { op: 'submit'; form: FormId }
  // Does it in code, with no form on a page: the irreversible step. `page` is where it is done by
  // hand, so the action is offered only to those who may open that page.
  | { op: 'perform'; task: TaskId; page?: PageId }
  | { op: 'list_actions' } // says and shows what the user can do here
) & { if?: string }; // a field name, or '!field'

export type ActionDefinition = {
  id: string;
  title: string;
  hint?: string;
  guide?: readonly string[];
  intent: IntentDefinition;
  effect: Effect;
  fields: Readonly<Record<string, FieldDefinition>>;
  // Fields of which at least one must be given, though none is required on its own: the first is asked.
  requireOneOf?: readonly string[];
  // How the confirm card reads when the generic "title with label “value”" would not say it clearly.
  summary?: (values: Record<string, FieldValue>) => string;
  // Rank among the starter cards, lowest first. Actions sharing a rank are alternatives: the
  // first visible one gets the card. Unranked ones fill what is left.
  starter?: number;
  plan: readonly PlanStep[];
  done?: string; // a template: "Done — {name} is ready."
  // What to offer when a run is refused with words that `when` matches: the action `offer`, with the
  // fields it shares with this one, put to the user as `say` (a template of this action's values).
  onRefused?: readonly { when: RegExp; offer: string; say: string }[];
  // 'list': the run leaves a list on screen, which is said and picked from instead of `done`.
  outcome?: 'list';
};

export function intentCriteria(action: Pick<ActionDefinition, 'intent'>): string {
  const { description, examples, notFor = [] } = action.intent;
  const quoted = examples.map(example => `"${example}"`).join(', ');
  const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`).join('; ');
  return [description, `Examples: ${quoted}.`, exclusions && `Not for: ${exclusions}.`]
    .filter(Boolean)
    .join(' ');
}

// What Jev is told about one action. Only actions with fields tell it what to read out of the
// sentence. Pure, so the live routing eval builds the very request the dashboard sends.
export const routeActionOf = (action: ActionDefinition): RouteAction => ({
  id: action.id,
  description: intentCriteria(action),
  ...(Object.keys(action.fields).length > 0 && {
    fields: Object.fromEntries(
      Object.entries(action.fields).map(([name, { describe, kind, options }]) => [
        name,
        { describe, kind, ...(options && { options: options.map(option => option.label) }) },
      ]),
    ),
  }),
});

// An action the user's role hides, as Jev is told of it: it may be chosen, so the user hears they
// lack access instead of getting its nearest neighbour. Nothing is read for it.
export const hiddenRouteActionOf = (action: ActionDefinition): RouteAction => ({
  id: action.id,
  description: intentCriteria(action),
  unavailable: true,
});

export const hasValue = (value: FieldValue | undefined): value is string => !!value?.trim();

// A plan step's `if`: a field name, or '!field'. The only place that syntax is read.
export const holds = (condition: string | undefined, values: Record<string, FieldValue>): boolean =>
  !condition ||
  (condition.startsWith('!') ? !hasValue(values[condition.slice(1)]) : hasValue(values[condition]));

// `{field}` is what the user said, `{field.id}` the record it was resolved to.
export const fillTemplate = (
  template: string,
  values: Record<string, FieldValue>,
  resolved: Readonly<Record<string, { id: string }>> = {},
): string =>
  template.replace(/\{(\w+)(\.id)?\}/g, (_, field: string, id?: string) =>
    id ? (resolved[field]?.id ?? '') : (values[field]?.trim() ?? ''),
  );
