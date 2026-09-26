import { operationSchema, type Plan } from './operations.js';
import type { FieldValue } from './references.js';

/**
 * The whole template language that action definitions use. Deliberately tiny:
 *
 * Text (questions, previews, replies):
 *   {field}      the field's value ("Priya Shah"; several people are joined with commas)
 *   [ … ]        an optional part, shown only when every {field} inside has a value
 *
 * Plan steps (operation parameters):
 *   "$field"     the field's value as-is (a person, a list of people, text, a choice id)
 *   "if": "field"  the step runs only when that field has a value
 *   { "fromStep": n }  the conversation produced by step n
 *
 * Nothing else: no expressions, filters, or dotted paths. Anything smarter belongs in the
 * engine, where every action gets it.
 */

export type Values = Readonly<Record<string, FieldValue | undefined>>;

const FIELD = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const OPTIONAL = /\[([^[\]]*)\]/g;

/** Fields a template uses: those it always needs, and those only inside optional parts. */
export function templateFields(template: string): { always: string[]; optional: string[] } {
  const optional = [...template.matchAll(OPTIONAL)].flatMap(([, inner]) => fieldsIn(inner ?? ''));
  const always = fieldsIn(template.replace(OPTIONAL, ''));
  return { always, optional };
}

export function renderTemplate(template: string, values: Values): string {
  return fill(
    template.replace(OPTIONAL, (_match, inner: string) =>
      fieldsIn(inner).every(field => hasValue(values[field])) ? inner : '',
    ),
    values,
  );
}

export function hasValue(value: FieldValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Display text for any field value. */
export function describeValue(value: FieldValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(person => person.name).join(', ');
  return value.name;
}

/** One plan step as written in a definition, before values are bound. */
export interface PlanStepDef {
  op: string;
  if?: string;
  [param: string]: unknown;
}

/**
 * Binds a definition's plan to collected values and validates every resulting operation.
 * Skipped conditional steps are removed and `fromStep` references are renumbered.
 * `many` fields that are absent bind to an empty list.
 */
export function bindPlan(
  steps: readonly PlanStepDef[],
  manyFields: ReadonlySet<string>,
  values: Values,
): Plan {
  const boundIndex = new Map<number, number>();
  const plan: Plan = [];
  steps.forEach((step, index) => {
    if (step.if !== undefined && !hasValue(values[step.if])) return;
    const bound: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(step)) {
      if (key === 'if') continue;
      bound[key] = bindParam(param, manyFields, values, boundIndex);
    }
    boundIndex.set(index, plan.length);
    plan.push(operationSchema.parse(bound));
  });
  return plan;
}

function bindParam(
  param: unknown,
  manyFields: ReadonlySet<string>,
  values: Values,
  boundIndex: ReadonlyMap<number, number>,
): unknown {
  if (typeof param === 'string' && param.startsWith('$')) {
    const field = param.slice(1);
    return values[field] ?? (manyFields.has(field) ? [] : undefined);
  }
  if (isFromStep(param)) {
    const index = boundIndex.get(param.fromStep);
    if (index === undefined) throw new Error(`Plan step references skipped step ${param.fromStep}`);
    return { fromStep: index };
  }
  return param;
}

export function isFromStep(value: unknown): value is { fromStep: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { fromStep?: unknown }).fromStep === 'number'
  );
}

function fieldsIn(text: string): string[] {
  return [...text.matchAll(FIELD)].map(([, field]) => field ?? '').filter(Boolean);
}

function fill(text: string, values: Values): string {
  return text.replace(FIELD, (_match, field: string) => describeValue(values[field]));
}
