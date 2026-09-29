import { z } from 'zod';
import { ENTITY_KINDS } from './references.js';

/**
 * The action format. An action is one thing the assistant can do, written as plain data: how
 * to recognise it, the details it needs, what to say, and the app operations that carry it out.
 * `loadActions` checks every action against this format when the app starts.
 */

const identifier = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case');

/**
 * What an action does to the workspace, which sets when it previews first:
 * - `read`, `navigate`  never.
 * - `send`              only when a detail was not stated exactly.
 * - `change`            always.
 */
const effect = z.enum(['read', 'navigate', 'send', 'change']);
const confirmPolicy = z.enum(['always', 'when-unclear', 'never']);

/** Text, a choice, or a record found by name (person, channel, thread). */
const FIELD_KINDS = ['text', 'choice', ...ENTITY_KINDS] as const;

const choiceOption = z
  .object({ id: z.string().min(1), label: z.string().min(1), detail: z.string().optional() })
  .strict();

const fieldShape = z
  .object({
    kind: z.enum(FIELD_KINDS),
    /** Holds several records, like members to add. */
    many: z.boolean().optional(),
    /** Keep message text the way the user wrote it. */
    preserveText: z.boolean().optional(),
    /** Use this person or channel to narrow a conversation search. */
    searchFilter: z.boolean().optional(),
    /** Required details are asked for until given; optional ones are offered once, if `offer` is set. */
    required: z.boolean(),
    /** The question. It may use earlier details: "What should I say[ to {recipient}]?" */
    ask: z.string().min(1),
    offer: z.string().min(1).optional(),
    /** The question when several records match; `{mention}` is what was said. */
    choose: z.string().min(1).optional(),
    /** A choice field's answers, shown as buttons. */
    options: z.array(choiceOption).min(2).optional(),
    /** What this detail means, for Jev. */
    describe: z.string().min(1),
  })
  .strict();

type FieldShape = z.infer<typeof fieldShape>;

const FIELD_RULES: ReadonlyArray<[broken: (field: FieldShape) => boolean, message: string]> = [
  [field => field.kind === 'choice' && !field.options, 'a choice needs options'],
  [field => field.kind !== 'choice' && Boolean(field.options), 'only choice fields have options'],
  [
    field => new Set(field.options?.map(option => option.id)).size !== (field.options?.length ?? 0),
    'duplicate option ids',
  ],
  [
    field => Boolean(field.many) && (field.kind === 'text' || field.kind === 'choice'),
    'only record fields can hold several values',
  ],
  [
    field => Boolean(field.preserveText) && field.kind !== 'text',
    'only text fields can preserve text',
  ],
  [
    field => Boolean(field.searchFilter) && field.kind !== 'person' && field.kind !== 'channel',
    'only people and channels can filter a conversation search',
  ],
  [field => Boolean(field.offer) && field.required, 'only optional fields are offered'],
];

const field = fieldShape.superRefine((value, context) => {
  for (const [broken, message] of FIELD_RULES) {
    if (broken(value)) context.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

const intent = z
  .object({
    /** One sentence: what the user wants when this action applies. */
    description: z.string().min(1),
    /** Real ways people ask for it. */
    examples: z.array(z.string().min(1)).min(2),
    /** Requests that sound similar but mean something else, and what they are instead. */
    notFor: z
      .array(z.object({ when: z.string().min(1), instead: z.string().min(1) }).strict())
      .optional(),
  })
  .strict();

const planStep = z
  .object({ op: z.string().min(1), if: z.string().optional() })
  .catchall(z.unknown());

export const actionDefinitionSchema = z
  .object({
    id: identifier,
    /** A short name for buttons: "Send a direct message". */
    title: z.string().min(1).max(60),
    intent,
    effect,
    /** Only when this action needs a different preview rule from its effect's. */
    confirm: confirmPolicy.optional(),
    /** The details it needs, asked for in this order. */
    fields: z.record(field),
    /** The preview line: "Send “{message}” to {recipient}". */
    summarize: z.string().min(1),
    /** The app operations that carry it out, in order, using `$field` values. */
    plan: z.array(planStep).min(1),
    /** What the assistant says when it has finished. */
    done: z.string().min(1),
  })
  .strict();

export const actionAreaSchema = z
  .object({
    id: identifier,
    /** One sentence describing the requests in this group. */
    description: z.string().min(1),
    actions: z.array(actionDefinitionSchema).min(1),
  })
  .strict();

export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;
export type ActionArea = z.infer<typeof actionAreaSchema>;
export type FieldDefinition = z.infer<typeof field>;
export type Effect = z.infer<typeof effect>;
export type ConfirmPolicy = z.infer<typeof confirmPolicy>;

/** Every action, by id, with its area grouping. Built only by `loadActions`. */
export class ActionCatalog {
  private readonly byId: ReadonlyMap<string, ActionDefinition>;

  constructor(readonly areas: readonly ActionArea[]) {
    this.byId = new Map(areas.flatMap(area => area.actions).map(action => [action.id, action]));
  }

  get(id: string): ActionDefinition | undefined {
    return this.byId.get(id);
  }

  values(): IterableIterator<ActionDefinition> {
    return this.byId.values();
  }
}

/** Ways to start: the first action of each area, so every area is represented. */
export function starterActions(catalog: ActionCatalog, limit = 4): ActionDefinition[] {
  return catalog.areas.flatMap(area => area.actions.slice(0, 1)).slice(0, limit);
}

const DEFAULT_CONFIRM: Record<Effect, ConfirmPolicy> = {
  read: 'never',
  navigate: 'never',
  send: 'when-unclear',
  change: 'always',
};

export function confirmPolicyOf(action: ActionDefinition): ConfirmPolicy {
  return action.confirm ?? DEFAULT_CONFIRM[action.effect];
}

/** Fields that hold several values. An empty one is passed to operations as an empty list. */
export function manyFieldsOf(action: ActionDefinition): ReadonlySet<string> {
  return new Set(Object.keys(action.fields).filter(id => action.fields[id]?.many));
}

/** The text Jev reads to recognise an action, built from its parts. */
export function intentCriteria(action: Pick<ActionDefinition, 'intent'>): string {
  const { description, examples, notFor = [] } = action.intent;
  const quoted = examples.map(example => `"${example}"`).join(', ');
  const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`).join('; ');
  return [description, `Examples: ${quoted}.`, exclusions && `Not for: ${exclusions}.`]
    .filter(Boolean)
    .join(' ');
}
