import { z } from 'zod';
import type { WorkflowContext } from '../types/context.js';
import { tokenize, isPureRef, extractRefPath } from '../util/variable-ref.js';
import { EXPRESSION_ROOTS } from '../expression/format.js';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Resolve a dotted path against a WorkflowContext.
 *
 * - `trigger.x.y` → context.trigger.x.y
 * - `workflow.id` → context.workflow.id
 * - `steps.stepId.output.field` → context.steps.stepId.output.field
 * - `someStepId.output.field` → context.steps.someStepId.output.field (shorthand)
 */
export function resolvePath(
  context: WorkflowContext,
  path: string,
): unknown {
  const segments = path.split('.');
  if (segments.length === 0) return undefined;
  if (segments.some((s) => FORBIDDEN_KEYS.has(s))) return undefined;

  const head = segments[0];
  if (head === undefined) return undefined;

  let current: unknown;
  let rest: string[];

  // The same five roots an expression may read, from the one list that names
  // them — two spellings of this would have to be kept level by hand, and the
  // one that drifted would silently resolve a path the other refused.
  if ((EXPRESSION_ROOTS as readonly string[]).includes(head)) {
    current = (context as unknown as Record<string, unknown>)[head];
    rest = segments.slice(1);
  } else {
    // Shorthand: bare step id → context.steps[id]
    current = context.steps[head];
    rest = segments.slice(1);
  }

  for (const segment of rest) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * How a value reads when it lands in the middle of text.
 *
 * Exported because the expression pre-pass must interpolate by exactly this
 * rule — `"Total: {% $sum(x) %}"` has to stringify its result the same way
 * `"Total: {{x}}"` does. Two copies of this would drift on the first edge case
 * (a Date, an object, null) and the difference would show up as a user-visible
 * formatting inconsistency between two things that look identical.
 */
export function stringifyForTemplate(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return typeof value === 'string' ? value : String(value);
}

const LEAF_KEYS: ReadonlySet<string> = new Set(['variable', 'operator', 'value']);

/**
 * Whether this object is a {@link Condition} — a leaf, or an `all`/`any` group.
 *
 * Structural, because that is what a condition is in this engine: the shape IS
 * the type, and every step that takes one declares it with the same schema.
 *
 * Matched exactly rather than loosely. A config object that merely *has* an
 * `any` array, or a `variable` beside fields of its own, is not a condition, and
 * skipping it would quietly leave someone's `{{refs}}` unresolved. So a leaf is
 * `variable` + `operator` and nothing but `value` besides, and a group is one
 * key, `all` or `any`, holding conditions.
 *
 * Exported so the expression pre-pass skips exactly the same objects this
 * resolver does. If the two ever disagreed about what a condition is, one of
 * them would rewrite a slot the other was protecting.
 */
export function isCondition(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  for (const join of ['all', 'any'] as const) {
    if (keys.length !== 1 || keys[0] !== join) continue;
    const parts = value[join];
    return Array.isArray(parts) && parts.every((part) => typeof part === 'object' && part !== null && isCondition(part as Record<string, unknown>));
  }
  return (
    typeof value['variable'] === 'string' &&
    typeof value['operator'] === 'string' &&
    keys.every((key) => LEAF_KEYS.has(key))
  );
}

/**
 * Recursively resolve `{{...}}` variable references in a config value.
 *
 * - **Pure ref** (`"{{trigger.x}}"`) → preserves the resolved type (number, object, etc.)
 * - **Template** (`"Hi {{trigger.name}}!"`) → interpolated string
 * - **Nested objects/arrays** → recursed
 * - **Conditions** → left alone; see {@link VariableResolver.resolve}
 * - **Non-string primitives** → returned as-is
 */
export class VariableResolver {
  /**
   * A condition is returned untouched, however deep it sits.
   *
   * Its `variable` is a reference the {@link ConditionEvaluator} resolves for
   * itself, one step later, so that it can tell "absent" from "empty" and read a
   * value of any type. Flattening it here would hand the evaluator a value where
   * it expects a path — `{{…plan}}` becomes `"priority"`, `extractRefPath`
   * returns null, and every condition silently answers as if the field were
   * missing.
   *
   * Control-flow steps (CONDITIONAL, SWITCH) never reach the resolver at all, so
   * this changes nothing for them — it extends the same treatment to a condition
   * carried by an action step's config, which is what lets a WAIT offer an option
   * only under some data.
   */
  resolve(value: unknown, context: WorkflowContext): unknown {
    if (typeof value === 'string') {
      return this.resolveString(value, context);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolve(item, context));
    }
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (isCondition(record)) return value;
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        resolved[k] = this.resolve(v, context);
      }
      return resolved;
    }
    return value;
  }

  resolveString(value: string, context: WorkflowContext): unknown {
    if (!value.includes('{{')) {
      return value;
    }
    if (isPureRef(value)) {
      const path = extractRefPath(value);
      if (path === null) return value;
      return resolvePath(context, path);
    }

    const tokens = tokenize(value);
    let result = '';
    for (const token of tokens) {
      if (token.kind === 'literal') {
        result += token.text;
      } else {
        const resolved = resolvePath(context, token.path);
        result += stringifyForTemplate(resolved);
      }
    }
    return result;
  }
}

/**
 * Strip null values for keys that are optional (accept undefined) but don't accept null.
 * This handles the case where a variable ref resolves to null for an optional field.
 */
export function stripNullForOptionalKeys(
  resolved: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  if (!(schema instanceof z.ZodObject)) return resolved;
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const result: Record<string, unknown> = { ...resolved };
  for (const key of Object.keys(result)) {
    if (result[key] !== null) continue;
    const field = shape[key];
    if (!field) continue;
    if (!field.safeParse(null).success && field.safeParse(undefined).success) {
      delete result[key];
    }
  }
  return result;
}

// ─── String-sink coercion ───
//
// "string is the universal sink": wherever the schema expects a string but the
// resolved value isn't one, stringify it (exactly how a template ref already
// behaves). The hard part is *locating* string slots through arbitrary config
// shapes (objects, arrays, discriminated unions, records, the `variableRef`
// union, …). Rather than re-walk the Zod schema by hand — fragile and always
// missing some combinator — we ask the validator: it already navigated the
// schema and reports, via the public `ZodError.issues` API, the exact paths
// where a string was expected. We stringify only there, leave everything else,
// then let the caller's `safeParse` produce the authoritative result.

type IssuePath = (string | number)[];

export function valueAtPath(obj: unknown, path: IssuePath): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[String(key)];
  }
  return cur;
}

/** Immutably set `value` at `path`, cloning objects/arrays along the way. */
export function setAtPath(obj: unknown, path: IssuePath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'string' && FORBIDDEN_KEYS.has(head)) return obj;
  if (Array.isArray(obj)) {
    const idx = Number(head);
    const copy = obj.slice();
    copy[idx] = setAtPath(obj[idx], rest, value);
    return copy;
  }
  const base = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  const key = String(head);
  return { ...base, [key]: setAtPath(base[key], rest, value) };
}

/**
 * Paths where a string was expected but not provided. Handles direct
 * `invalid_type` issues and `invalid_union` (e.g. the `variableRef` union, whose
 * string variant reports a string-expected issue relative to the union's slot).
 */
function collectStringExpectedPaths(error: z.ZodError): IssuePath[] {
  const out: IssuePath[] = [];
  // Zod issue paths are absolute from the parse root — including those inside a
  // union's `unionErrors` — so we never accumulate a base path.
  const visit = (issues: z.ZodIssue[]): void => {
    for (const iss of issues) {
      if (iss.code === z.ZodIssueCode.invalid_type && iss.expected === 'string') {
        out.push(iss.path);
      } else if (iss.code === z.ZodIssueCode.invalid_union) {
        for (const sub of iss.unionErrors) visit(sub.issues);
      }
    }
  };
  visit(error.issues);
  return out;
}

/**
 * Stringify resolved non-string values that sit in string-typed schema slots
 * (the runtime half of the "string is the universal sink" rule). Validator-
 * guided so it's complete across any config shape; only string slots are
 * touched — number/boolean/enum/array/object targets are left strict and fail
 * loudly if genuinely mismatched. Returns the (possibly) coerced value; the
 * caller still `safeParse`s for the final, authoritative validation.
 */
export function coerceResolvedToSchema(
  value: unknown,
  schema: z.ZodTypeAny,
  maxPasses = 5,
): unknown {
  let cur = value;
  for (let pass = 0; pass < maxPasses; pass++) {
    const res = schema.safeParse(cur);
    if (res.success) return cur;
    let changed = false;
    for (const path of collectStringExpectedPaths(res.error)) {
      const v = valueAtPath(cur, path);
      if (v !== null && v !== undefined && typeof v !== 'string') {
        cur = setAtPath(cur, path, stringifyForTemplate(v));
        changed = true;
      }
    }
    if (!changed) return cur; // remaining failures aren't string-coercible
  }
  return cur;
}
