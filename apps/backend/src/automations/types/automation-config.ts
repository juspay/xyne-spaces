import { z } from 'zod';
import type { TriggerType } from './trigger-types';
import type { StepType } from './step-types';
import { ControlFlowStepType } from './known-types';
import { compileConditionRegex, ConditionOperator, ConditionOperatorSchema } from './operators';
import { TAG_FORMAT_REGEX } from '@xyne/shared';
import { isPureRef } from '../util/variable-ref';

function isValidHasTagValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const firstColon = value.indexOf(':');
  const secondColon = value.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) return false;
  const category = value.slice(0, firstColon);
  const match = value.slice(firstColon + 1, secondColon);
  const tags = value.slice(secondColon + 1).split(',').filter(Boolean);
  if (!category || !TAG_FORMAT_REGEX.test(category)) return false;
  if (match !== 'any' && match !== 'all') return false;
  if (tags.length === 0) return false;
  return tags.every(t => TAG_FORMAT_REGEX.test(t));
}

export {
  VARIABLE_REF_REGEX,
  VARIABLE_REF_DESCRIPTION_PREFIX,
} from '@xyne/shared/automations/variable-ref';
import {
  VARIABLE_REF_REGEX,
  VARIABLE_REF_DESCRIPTION_PREFIX,
} from '@xyne/shared/automations/variable-ref';

const variableRefStringSchema = z
  .string()
  .regex(VARIABLE_REF_REGEX, 'Must be a {{context.<path>}} reference');

export function variableRef<T extends z.ZodTypeAny>(inner: T): z.ZodUnion<[T, z.ZodString]> {
  return z
    .union([inner, variableRefStringSchema])
    .describe(`${VARIABLE_REF_DESCRIPTION_PREFIX}${inner.description ?? inner._def.typeName}`) as z.ZodUnion<[T, z.ZodString]>;
}

export function getVariableRefInnerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  if (
    schema instanceof z.ZodUnion &&
    typeof schema.description === 'string' &&
    schema.description.startsWith(VARIABLE_REF_DESCRIPTION_PREFIX)
  ) {
    const options = (schema as z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny]>)._def.options;
    return options[0] ?? null;
  }
  return null;
}

export interface LeafCondition {
  variable: string;
  operator: ConditionOperator;
  value?: unknown;
}

export type Condition =
  | LeafCondition
  | { all: Condition[] }
  | { any: Condition[] };

export const LeafConditionSchema: z.ZodType<LeafCondition> = z.object({
  variable: variableRefStringSchema,
  operator: ConditionOperatorSchema,
  value: z.unknown().optional(),
}).superRefine((val, ctx) => {
  if (val.operator === ConditionOperator.HAS_TAG && !isValidHasTagValue(val.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'has_tag value must be "category:any|all:tag1,tag2,..." with valid tag names',
    });
  }
  if (
    val.operator === ConditionOperator.MATCHES_REGEX &&
    (typeof val.value !== 'string' ||
      (!isPureRef(val.value) && compileConditionRegex(val.value) === null))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'matches_regex value must be a valid pattern such as "call\\s+now" or "/call/i"',
    });
  }
});

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    LeafConditionSchema,
    z.object({ all: z.array(ConditionSchema) }),
    z.object({ any: z.array(ConditionSchema) }),
  ]),
);

export interface ActionStepConfig {
  id: string;
  type: Exclude<StepType, ControlFlowStepType>;
  config: Record<string, unknown>;
}

export interface ConditionalStepConfig {
  id: string;
  type: ControlFlowStepType.CONDITIONAL;
  config: {
    condition: Condition;
    if_true: AutomationStepConfig[];
    if_false?: AutomationStepConfig[];
  };
}

export interface SwitchCaseEntry {
  condition: Condition;
  label?: string;
  steps: AutomationStepConfig[];
}

export interface SwitchStepConfig {
  id: string;
  type: ControlFlowStepType.SWITCH;
  config: {
    cases: SwitchCaseEntry[];
    default: AutomationStepConfig[];
  };
}

export type AutomationStepConfig = ActionStepConfig | ConditionalStepConfig | SwitchStepConfig;

export const ScheduleOffsetUnitSchema = z.enum(['minutes', 'hours', 'days']);
export type ScheduleOffsetUnit = z.infer<typeof ScheduleOffsetUnitSchema>;

export const ScheduleOffsetSchema = z.object({
  amount: z.number().int().positive(),
  unit: ScheduleOffsetUnitSchema,
});
export type ScheduleOffset = z.infer<typeof ScheduleOffsetSchema>;

export const ImmediateScheduleSchema = z.object({
  type: z.literal('IMMEDIATE'),
});

export const ScheduledScheduleSchema = z.object({
  type: z.literal('SCHEDULED'),
  field: z.string().min(1),
  offset: ScheduleOffsetSchema,
});

export const ScheduleConfigSchema = z.discriminatedUnion('type', [
  ImmediateScheduleSchema,
  ScheduledScheduleSchema,
]);
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export const MAX_SCHEDULE_OFFSET_MINUTES = 30 * 24 * 60;

export function scheduleOffsetMs(offset: ScheduleOffset): number {
  const minutes =
    offset.unit === 'minutes'
      ? offset.amount
      : offset.unit === 'hours'
        ? offset.amount * 60
        : offset.amount * 60 * 24;
  return minutes * 60 * 1000;
}

export function readDottedPath(payload: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function coerceToDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function computeScheduleRunAt(
  schedule: Extract<ScheduleConfig, { type: 'SCHEDULED' }>,
  payload: Record<string, unknown>,
): number | null {
  const fieldValue = readDottedPath(payload, schedule.field);
  const fieldDate = coerceToDate(fieldValue);
  if (!fieldDate) return null;
  return fieldDate.getTime() + scheduleOffsetMs(schedule.offset);
}

export interface AutomationConfig {
  trigger: {
    type: TriggerType;
    config: Record<string, unknown>;
  };
  schedule?: ScheduleConfig;
  steps: AutomationStepConfig[];
}
