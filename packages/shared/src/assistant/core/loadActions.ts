import { z } from 'zod';
import { actionAreaSchema, ActionCatalog, type ActionDefinition } from './action.js';
import {
  OPERATION_PARAMS,
  OPERATION_PRODUCES,
  OPERATION_REQUIRED_PARAMS,
  type OperationName,
} from './operations.js';
import { isFromStep, templateFields, type PlanStepDef } from './templates.js';

/**
 * Checks every action when the app starts. A mistake stops startup and names the action and
 * the problem, instead of surfacing in the middle of a conversation. The schema checks each
 * part; the checks here compare parts with each other: templates and plans against fields,
 * plan steps against operations and earlier steps.
 */
export function loadActions(areas: readonly unknown[]): ActionCatalog {
  const parsed = z.array(actionAreaSchema).safeParse(areas);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => describeIssue(issue, areas)).join('; '));
  }
  const actions = parsed.data.flatMap(area => area.actions);
  failOn([
    ...duplicates(parsed.data.map(area => area.id)).map(id => `Duplicate area id: ${id}`),
    ...duplicates(actions.map(action => action.id)).map(id => `Duplicate action id: ${id}`),
    ...actions.flatMap(action =>
      problemsIn(action).map(problem => `Action ${action.id}: ${problem}`),
    ),
  ]);
  return new ActionCatalog(parsed.data);
}

function problemsIn(action: ActionDefinition): string[] {
  const fields = Object.entries(action.fields);
  const steps = action.plan as PlanStepDef[];
  return [
    ...fields.flatMap(([id, field], order) => [
      ...unknownFieldsIn(action, `field ${id} ask`, field.ask),
      ...unknownFieldsIn(action, `field ${id} offer`, field.offer ?? ''),
      ...askedTooEarly(
        action,
        id,
        fields.slice(0, order).map(([earlier]) => earlier),
      ),
    ]),
    ...textProblems(action, 'summarize', action.summarize),
    ...textProblems(action, 'done', action.done),
    ...steps.flatMap((_step, index) => stepProblems(action, steps, index)),
  ];
}

/** A question can only rely on required details asked before it; anything else goes in [ ]. */
function askedTooEarly(action: ActionDefinition, id: string, earlier: readonly string[]): string[] {
  return templateFields(action.fields[id]?.ask ?? '')
    .always.filter(used => !earlier.includes(used) || !action.fields[used]?.required)
    .map(used => `field ${id} ask needs {${used}} before it is asked; wrap it in [ ]`);
}

/** A preview or final line always shows only required details; optional ones go in [ ]. */
function textProblems(action: ActionDefinition, name: string, template: string): string[] {
  const shownOptional = templateFields(template)
    .always.filter(used => action.fields[used] && !action.fields[used]?.required)
    .map(used => `${name} always shows optional field {${used}}; wrap it in [ ]`);
  return [...unknownFieldsIn(action, name, template), ...shownOptional];
}

function unknownFieldsIn(action: ActionDefinition, where: string, template: string): string[] {
  const { always, optional } = templateFields(template);
  return [...always, ...optional]
    .filter(used => !action.fields[used])
    .map(used => `${where} uses unknown field {${used}}`);
}

function stepProblems(action: ActionDefinition, steps: PlanStepDef[], index: number): string[] {
  const { op, if: condition, ...args } = steps[index] ?? { op: '' };
  const where = `plan step ${index} (${op})`;
  const params = OPERATION_PARAMS.get(op);
  if (!params) return [`${where}: unknown operation`];

  const required = [...(OPERATION_REQUIRED_PARAMS.get(op as OperationName) ?? [])];
  const problems = [
    ...required.filter(param => !(param in args)).map(param => `missing parameter ${param}`),
    ...conditionProblems(action, condition),
    ...Object.entries(args).flatMap(([key, value]) => {
      if (!params.has(key)) return [`unknown parameter ${key}`];
      if (typeof value === 'string' && value.startsWith('$')) {
        return bindingProblems(action, key, value.slice(1), condition);
      }
      return isFromStep(value) ? fromStepProblems(steps, index, value.fromStep) : [];
    }),
  ];
  return problems.map(problem => `${where}: ${problem}`);
}

function conditionProblems(action: ActionDefinition, condition: string | undefined): string[] {
  if (condition === undefined) return [];
  const field = action.fields[condition];
  if (!field) return [`"if" uses unknown field ${condition}`];
  return field.required ? [`"if" on required field ${condition}`] : [];
}

/** An optional single value can be missing, so the step that uses it must depend on it. */
function bindingProblems(
  action: ActionDefinition,
  key: string,
  id: string,
  condition: string | undefined,
): string[] {
  const field = action.fields[id];
  if (!field) return [`${key} uses unknown field $${id}`];
  if (!field.required && !field.many && condition !== id)
    return [`optional $${id} needs "if": "${id}"`];
  return [];
}

/** `fromStep` uses the channel an earlier, unconditional step produced. */
function fromStepProblems(steps: PlanStepDef[], index: number, from: number): string[] {
  const target = steps[from];
  if (!target || from >= index) return ['fromStep must point to an earlier step'];
  if (OPERATION_PRODUCES.get(target.op as OperationName) !== 'channel') {
    return [`step ${from} (${target.op}) does not produce a channel`];
  }
  return target.if === undefined ? [] : [`fromStep points to conditional step ${from}`];
}

/** "action send_dm: fields.message.ask Required", naming the action where there is one. */
function describeIssue(issue: z.ZodIssue, areas: readonly unknown[]): string {
  const [areaIndex, section, actionIndex, ...rest] = issue.path;
  const area = areas[Number(areaIndex)] as { id?: unknown; actions?: Array<{ id?: unknown }> };
  if (section === 'actions' && typeof actionIndex === 'number') {
    const actionId = String(area?.actions?.[actionIndex]?.id);
    return `action ${actionId}: ${rest.join('.') || '(action)'} ${issue.message}`;
  }
  return `area ${String(area?.id)}: ${issue.path.slice(1).join('.') || '(area)'} ${issue.message}`;
}

function duplicates(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function failOn(problems: readonly string[]): void {
  if (problems.length) throw new Error(problems.join('; '));
}
