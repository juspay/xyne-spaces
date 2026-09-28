import { z } from 'zod';
import {
  OPERATION_PARAMS,
  OPERATION_PRODUCES,
  OPERATION_REQUIRED_PARAMS,
  type OperationName,
} from './operations.js';
import { ENTITY_KINDS } from './references.js';
import { isFromStep, templateFields, type PlanStepDef } from './templates.js';

/**
 * The action format. An action is one thing the assistant can do, written as plain data: how
 * to recognise it, the details it needs, and the app operations that carry it out. Actions are
 * grouped into areas so the backend can compare related actions together.
 */

const identifier = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case');

/**
 * What an action does to the workspace. This sets how careful the assistant is by default:
 * - `read`      looks something up.                  Runs straight away.
 * - `navigate`  opens a page or conversation.        Runs straight away.
 * - `send`      sends words to other people.         Asks first if anything was unclear.
 * - `change`    creates or changes something.        Always shows a preview first.
 */
const effect = z.enum(['read', 'navigate', 'send', 'change']);

/** Text, a choice, or a record found by name (person, channel, thread…). */
const FIELD_KINDS = ['text', 'choice', ...ENTITY_KINDS] as const;

/**
 * When the assistant asks "Shall I…?" before running:
 * - `always`        show a preview and wait for "yes".
 * - `when-unclear`  run straight away only if every detail was stated clearly.
 * - `never`         run straight away.
 */
const confirmPolicy = z.enum(['always', 'when-unclear', 'never']);

const choiceOption = z
  .object({ id: z.string().min(1), label: z.string().min(1), detail: z.string().optional() })
  .strict();

const field = z
  .object({
    /**
     * - `text`     words from the request, such as a message or a name.
     * - `choice`   one of `options`; the value is the option's id.
     * - any record kind (`person`, `channel`, `thread`…): found by name by the backend.
     */
    kind: z.enum(FIELD_KINDS),
    /** Holds several records (for example, members to add). Only for record kinds. */
    many: z.boolean().optional(),
    /** Required details are asked for until given. Optional ones are offered once, if `offer` is set. */
    required: z.boolean(),
    /** The question for this detail. It may mention earlier details: "What should I say[ to {recipient}]?" */
    ask: z.string().min(1),
    /** For optional details: asked once ("Want to add anyone?"). "No" skips it. */
    offer: z.string().min(1).optional(),
    /** For record details: the question when several records match; `{mention}` is what was said. */
    choose: z.string().min(1).optional(),
    /** For `choice` fields: the allowed answers, shown as buttons. */
    options: z.array(choiceOption).min(2).optional(),
    /** For the language model: what this detail means, with a short example if it helps. */
    describe: z.string().min(1),
  })
  .strict();

const intent = z
  .object({
    /** One sentence: what the user wants when this action applies. */
    description: z.string().min(1),
    /** Real ways people ask for it. They also serve as test cases for recognition. */
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
    /** A short name for buttons and questions: "Send a direct message". */
    title: z.string().min(1).max(60),
    intent,
    effect,
    /** Only when this action needs a different rule from its effect's default. */
    confirm: confirmPolicy.optional(),
    /** The details the action needs, asked for in this order. */
    fields: z.record(field),
    /** The one-line preview: "Send “{message}” to {recipient}". */
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
    /** One sentence describing the requests covered by this group. */
    description: z.string().min(1),
    actions: z.array(actionDefinitionSchema).min(1),
  })
  .strict();

export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;
export type ActionArea = z.infer<typeof actionAreaSchema>;
export type FieldDefinition = z.infer<typeof field>;
export type Effect = z.infer<typeof effect>;
export type ConfirmPolicy = z.infer<typeof confirmPolicy>;

/** Action lookup by id, alongside the original area grouping. */
export class ActionCatalog {
  private readonly byId = new Map<string, ActionDefinition>();

  constructor(readonly areas: readonly ActionArea[]) {
    for (const action of areas.flatMap(area => area.actions)) this.byId.set(action.id, action);
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
  return new Set(
    Object.entries(action.fields)
      .filter(([, definition]) => definition.many)
      .map(([id]) => id),
  );
}

/** The text the intent model reads to recognise an action, built from its parts. */
export function intentCriteria(action: Pick<ActionDefinition, 'intent'>): string {
  const { description, examples, notFor } = action.intent;
  const parts = [description, `Examples: ${examples.map(example => `"${example}"`).join(', ')}.`];
  if (notFor?.length) {
    const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`);
    parts.push(`Not for: ${exclusions.join('; ')}.`);
  }
  return parts.join(' ');
}

/** Validates action definitions and plan references before building the catalog. */
export function loadActions(areas: readonly unknown[]): ActionCatalog {
  const loaded: ActionArea[] = [];
  const actionIds = new Set<string>();
  const areaIds = new Set<string>();
  for (const raw of areas) {
    const parsed = actionAreaSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Area ${String(idOf(raw))}: ${describeIssues(parsed.error, raw)}`);
    }
    const area = parsed.data;
    if (areaIds.has(area.id)) throw new Error(`Duplicate area id: ${area.id}`);
    areaIds.add(area.id);
    for (const action of area.actions) {
      if (actionIds.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`);
      actionIds.add(action.id);
      const problems = checkAction(action);
      if (problems.length) throw new Error(`Action ${action.id}: ${problems.join('; ')}`);
    }
    loaded.push(area);
  }
  return new ActionCatalog(loaded);
}

function idOf(value: unknown): unknown {
  return (value as { id?: unknown } | null)?.id;
}

/** Names the action an issue belongs to: "Action send_dm: fields.message.ask Required". */
function describeIssues(error: z.ZodError, rawArea: unknown): string {
  return error.issues
    .map(issue => {
      const [first, index, ...rest] = issue.path;
      if (first === 'actions' && typeof index === 'number') {
        const actions = (rawArea as { actions?: unknown[] } | null)?.actions;
        const where = rest.join('.') || '(action)';
        return `action ${String(idOf(actions?.[index]))}: ${where} ${issue.message}`;
      }
      return `${issue.path.join('.') || '(area)'} ${issue.message}`;
    })
    .join('; ');
}

/** Checks references and rules that the action schema cannot express. */
function checkAction(action: ActionDefinition): string[] {
  return [...checkFields(action), ...checkTextTemplates(action), ...checkPlan(action)];
}

function checkFields(action: ActionDefinition): string[] {
  const problems: string[] = [];
  const ids = Object.keys(action.fields);
  const known = new Set(ids);

  for (const [order, id] of ids.entries()) {
    const field = action.fields[id];
    if (!field) continue;

    if (field.kind === 'choice') {
      if (!field.options) problems.push(`field ${id}: a choice needs options`);
      const optionIds = field.options?.map(option => option.id) ?? [];
      if (new Set(optionIds).size !== optionIds.length) {
        problems.push(`field ${id}: duplicate option ids`);
      }
    } else if (field.options) {
      problems.push(`field ${id}: only choice fields have options`);
    }
    if (field.many && (field.kind === 'text' || field.kind === 'choice')) {
      problems.push(`field ${id}: only record fields can hold several values`);
    }
    if (field.offer && field.required) {
      problems.push(`field ${id}: only optional fields are offered`);
    }

    const ask = templateFields(field.ask);
    for (const used of [...ask.always, ...ask.optional]) {
      if (!known.has(used)) problems.push(`field ${id} ask uses unknown field {${used}}`);
    }
    const earlier = new Set(ids.slice(0, order));
    for (const used of ask.always) {
      if (!earlier.has(used) || !action.fields[used]?.required) {
        problems.push(`field ${id} ask needs {${used}} before it is asked; wrap it in [ ]`);
      }
    }

    if (field.offer) {
      const offer = templateFields(field.offer);
      for (const used of [...offer.always, ...offer.optional]) {
        if (!known.has(used)) problems.push(`field ${id} offer uses unknown field {${used}}`);
      }
    }
  }

  return problems;
}

function checkTextTemplates(action: ActionDefinition): string[] {
  const problems: string[] = [];
  const known = new Set(Object.keys(action.fields));

  for (const [name, template] of [
    ['summarize', action.summarize],
    ['done', action.done],
  ] as const) {
    const fields = templateFields(template);
    for (const used of [...fields.always, ...fields.optional]) {
      if (!known.has(used)) problems.push(`${name} uses unknown field {${used}}`);
    }
    for (const used of fields.always) {
      if (!action.fields[used]?.required) {
        problems.push(`${name} always shows optional field {${used}}; wrap it in [ ]`);
      }
    }
  }

  return problems;
}

function checkPlan(action: ActionDefinition): string[] {
  const problems: string[] = [];
  const steps = action.plan as PlanStepDef[];

  for (const [index, step] of steps.entries()) {
    const where = `plan step ${index} (${step.op})`;
    const params = OPERATION_PARAMS.get(step.op);
    if (!params) {
      problems.push(`${where}: unknown operation`);
      continue;
    }

    for (const parameter of OPERATION_REQUIRED_PARAMS.get(step.op as OperationName) ?? []) {
      if (!(parameter in step)) problems.push(`${where}: missing parameter ${parameter}`);
    }
    if (step.if !== undefined) {
      const condition = action.fields[step.if];
      if (!condition) problems.push(`${where}: "if" uses unknown field ${step.if}`);
      else if (condition.required) problems.push(`${where}: "if" on required field ${step.if}`);
    }

    for (const [key, value] of Object.entries(step)) {
      if (key === 'op' || key === 'if') continue;
      if (!params.has(key)) problems.push(`${where}: unknown parameter ${key}`);
      if (typeof value === 'string' && value.startsWith('$')) {
        const fieldId = value.slice(1);
        const field = action.fields[fieldId];
        if (!field) problems.push(`${where}: ${key} uses unknown field ${value}`);
        else if (!field.required && !field.many && step.if !== fieldId) {
          problems.push(`${where}: optional ${value} needs "if": "${fieldId}"`);
        }
      }
      if (isFromStep(value)) {
        const target = steps[value.fromStep];
        if (value.fromStep >= index || !target) {
          problems.push(`${where}: fromStep must point to an earlier step`);
        } else if (OPERATION_PRODUCES.get(target.op as OperationName) !== 'channel') {
          problems.push(`${where}: step ${value.fromStep} (${target.op}) does not produce a channel`);
        } else if (target.if !== undefined) {
          problems.push(`${where}: fromStep points to conditional step ${value.fromStep}`);
        }
      }
    }
  }

  return problems;
}
