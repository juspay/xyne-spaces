/**
 * Author-time workflow variables — fixed values defined once when a workflow is
 * authored and referenced by steps via `{{vars.<key>}}`.
 *
 * Unlike trigger inputs (passed per execution), a variable is the same for every
 * run: a policy PDF, a company name, a threshold, a rules table. Values are
 * literals (a variable never itself contains `{{}}`), non-secret (secrets belong
 * in credentials), and immutable per execution (editing one edits the workflow
 * definition).
 */

import { z } from 'zod';
import {
  AttachmentSchema,
  ATTACHMENT_JSON_SCHEMA,
  ATTACHMENT_ARRAY_JSON_SCHEMA,
} from '../common/attachment.js';

/** Recursive JSON value — a real type, not `unknown`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

/**
 * A variable key must be a valid identifier so `{{vars.<key>}}` is addressable
 * under the dot-only ref grammar (no dots, spaces, or brackets in the key).
 */
export const VariableKeySchema = z
  .string()
  .regex(
    /^[A-Za-z_$][A-Za-z0-9_$]*$/,
    'variable key must be a valid identifier (letters, digits, _ or $; no dots or spaces)',
  );

const withMeta = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    key: VariableKeySchema,
    description: z.string().optional(),
    ...shape,
  });

/**
 * A single workflow variable. Discriminated on `type` so each variant's `value`
 * is exactly typed — no `unknown` on the value.
 */
export const WorkflowVariableSchema = z.discriminatedUnion('type', [
  withMeta({ type: z.literal('text'), value: z.string() }),
  withMeta({ type: z.literal('number'), value: z.number() }),
  withMeta({ type: z.literal('boolean'), value: z.boolean() }),
  withMeta({ type: z.literal('json'), value: JsonValueSchema }),
  withMeta({ type: z.literal('document'), value: AttachmentSchema }),
  withMeta({ type: z.literal('documents'), value: z.array(AttachmentSchema) }),
]);

export type WorkflowVariable = z.infer<typeof WorkflowVariableSchema>;

/** The `type` discriminant — the set of variable kinds, for UI selectors. */
export type WorkflowVariableType = WorkflowVariable['type'];

/**
 * The union a `{{vars.<key>}}` reference can resolve to — the typed value that
 * lands in {@link WorkflowContext.vars}.
 */
export type VariableValue = WorkflowVariable['value'];

/**
 * Project a variable list into the resolution record the executor injects as
 * `context.vars`. Values are already concrete, so nothing is re-resolved here —
 * a `{{vars.x}}` ref simply reads this map. Later definitions win on key clash.
 *
 * The stored `value` is coerced to the declared `type` on projection: configs
 * saved by older editors (or seeded externally) may hold a string where a
 * number/boolean was declared, and every runtime reader — executors, trigger
 * filters, start policies — should see the typed value rather than repeat the
 * coercion. Uncoercible values pass through unchanged rather than being
 * silently zeroed.
 */
export function projectVariables(
  variables: readonly WorkflowVariable[] | undefined,
): Record<string, VariableValue> {
  const out: Record<string, VariableValue> = {};
  // Skip unnamed draft rows — an empty key must never become `vars['']`.
  for (const v of variables ?? []) {
    if (v.key.trim()) out[v.key] = coerceVariableValue(v.value, v.type);
  }
  return out;
}

function coerceVariableValue(value: unknown, type: WorkflowVariable['type']): VariableValue {
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return value;
      const n = Number(value);
      return Number.isFinite(n) ? n : (value as VariableValue);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value as VariableValue;
    }
    default:
      return value as VariableValue;
  }
}

/**
 * JSON-Schema view of the declared variables — a single source of truth reused
 * by the config validator (to type-check `{{vars.x}}` and flag unknown keys) and
 * the variable picker (to list `vars.<key>` with the right kind). Attachment
 * kinds carry the `format: 'attachment'` marker via the shared attachment schema.
 */
export function varsJsonSchema(
  variables: readonly WorkflowVariable[] | undefined,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const v of variables ?? []) {
    // Skip unnamed draft rows so the picker never offers a `{{vars.}}` entry.
    if (!v.key.trim()) continue;
    switch (v.type) {
      case 'text':
        properties[v.key] = { type: 'string' };
        break;
      case 'number':
        properties[v.key] = { type: 'number' };
        break;
      case 'boolean':
        properties[v.key] = { type: 'boolean' };
        break;
      case 'json':
        // Structured data — shape is author-defined; leave it open for the walker.
        properties[v.key] = { type: 'object' };
        break;
      case 'document':
        properties[v.key] = ATTACHMENT_JSON_SCHEMA;
        break;
      case 'documents':
        properties[v.key] = ATTACHMENT_ARRAY_JSON_SCHEMA;
        break;
    }
  }
  return { type: 'object', properties };
}
