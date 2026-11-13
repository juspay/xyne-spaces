/**
 * Evaluates every `{% … %}` in a config before the step runs, so the
 * synchronous resolver after it sees only values.
 *
 * Returns the input untouched when there are none, which is most configs.
 * Conditions are skipped: their halves are resolved one at a time, later.
 */
import type { WorkflowContext } from '../types/context.js';
import { compileExpression } from '../expression/parse.js';
import {
  collectExpressions,
  extractExpressionSource,
  hasExpression,
  isExpression,
  tokenizeExpressions,
} from '../expression/format.js';
import { extractRefPath, isPureRef } from '../util/variable-ref.js';
import {
  VariableResolver,
  isCondition,
  resolvePath,
  stringifyForTemplate,
} from './variable-resolver.js';

/** An expression that could not be evaluated. */
export class ExpressionError extends Error {
  readonly source: string;
  readonly location: string;
  /** JSONata's error code (`T2002`, `D1012`, …) when it supplied one. */
  readonly code: string | undefined;

  constructor(source: string, location: string, cause: unknown) {
    // JSONata throws a plain object, not an `Error` — it carries `code`,
    const detail = messageOf(cause);
    super(`Expression at "${location}" failed: ${detail}\n  {% ${source} %}`);
    this.name = 'ExpressionError';
    this.source = source;
    this.location = location;
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === 'string' ? code : undefined;
  }
}

/** Whatever was thrown, said in words. */
function messageOf(cause: unknown): string {
  if (cause !== null && typeof cause === 'object') {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return typeof cause === 'string' && cause !== '' ? cause : 'the expression could not be evaluated';
}

/** One expression that ran, and what it produced. */
export interface EvaluatedExpression {
  source: string;
  value: unknown;
}

export interface ExpressionResolution {
  /** The config with every expression replaced by its value. */
  value: unknown;
  /** Every distinct expression that ran. */
  evaluated: readonly EvaluatedExpression[];
}

const NOTHING: readonly EvaluatedExpression[] = [];

/**
 * The data an expression may read: the five documented context roots, and nothing else.
 */
function expressionInput(context: WorkflowContext): Record<string, unknown> {
  return {
    trigger: context.trigger,
    workflow: context.workflow,
    execution: context.execution,
    steps: context.steps,
    vars: context.vars,
  };
}

/**
 * Evaluate one expression source against a context, normalised and with the failure described in terms of where it sat.
 */
async function evaluate(
  source: string,
  location: string,
  context: WorkflowContext,
): Promise<unknown> {
  try {
    return plainValue(await compileExpression(source).evaluate(expressionInput(context)));
  } catch (cause) {
    throw new ExpressionError(source, location, cause);
  }
}

/** Replace every `{% ... */
export async function resolveExpressions(
  value: unknown,
  context: WorkflowContext,
): Promise<ExpressionResolution> {
  // Cheapest question first, because this runs for every step of every workflow
  if (collectExpressions(value, '').length === 0) return { value, evaluated: NOTHING };

  const found = collectExpressions(value, '', conditionsIn(value));
  // Every expression sat in a condition, where nothing evaluates it. The config
  if (found.length === 0) return { value, evaluated: NOTHING };

  // Distinct sources only: the same expression in two fields is one evaluation,
  const where = new Map<string, string>();
  for (const f of found) if (!where.has(f.source)) where.set(f.source, f.location);

  // One at a time, deliberately. Evaluation is pure CPU — no user function can
  // await anything — so running them together interleaves without finishing any
  // sooner, and `EXPRESSION_LIMITS.timeout` is wall-clock *per expression*.
  // Together, eight expressions of 165ms each failed the step at 1000ms and
  // blamed the first one. Separately they take the same total time and each
  // gets the budget it was promised.
  const values = new Map<string, unknown>();
  for (const [source, location] of where) {
    values.set(source, await evaluate(source, location, context));
  }
  const sources = [...values.keys()];

  return {
    value: substitute(value, values),
    evaluated: sources.map((source) => ({ source, value: values.get(source) })),
  };
}

// ─── Single slots ───

/** Stateless; see VariableResolver. One instance is enough for the module. */
const resolver = new VariableResolver();

/** Resolve a slot that says *where a value comes from* rather than holding one. */
export async function resolveReference(
  spec: string,
  context: WorkflowContext,
): Promise<unknown> {
  if (isExpression(spec)) {
    const source = extractExpressionSource(spec);
    if (source === null) return undefined;
    return evaluate(source, spec, context);
  }
  const path = isPureRef(spec) ? extractRefPath(spec) : spec;
  return path === null ? undefined : resolvePath(context, path);
}

/**
 * Resolve a slot that *holds* a value — a literal, a reference, an expression, or a structure containing them.
 */
export async function resolveValue(
  value: unknown,
  context: WorkflowContext,
): Promise<unknown> {
  const { value: prepared } = await resolveExpressions(value, context);
  return resolver.resolve(prepared, context);
}

/**
 * Condition objects reachable in a config, collected by identity so the expression walk can skip them wholesale — the same contract `collectRefs` already takes a `skip` set for.
 */
export function conditionsIn(value: unknown): ReadonlySet<unknown> {
  const out = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (isCondition(node as Record<string, unknown>)) {
        out.add(node);
        return;
      }
      for (const child of Object.values(node as Record<string, unknown>)) walk(child);
    }
  };
  walk(value);
  return out;
}

/** Strip JSONata's bookkeeping off a result. */
function plainValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const tagged = Object.keys(value).some((key) => !/^\d+$/.test(key));
    const items = value.map(plainValue);
    if (!tagged && items.every((item, i) => item === value[i])) return value;
    return items;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = plainValue(item);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/** Rebuild the config with each expression swapped for its value. */
function substitute(value: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === 'string') return substituteString(value, values);
  if (Array.isArray(value)) return value.map((item) => substitute(item, values));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (isCondition(record)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) out[k] = substitute(v, values);
    return out;
  }
  return value;
}

function substituteString(value: string, values: ReadonlyMap<string, unknown>): unknown {
  if (!hasExpression(value)) return value;

  // A lone expression keeps its type — the number 320, not "320".
  if (isExpression(value)) {
    const source = extractExpressionSource(value);
    return source !== null && values.has(source) ? values.get(source) : value;
  }

  // Mixed with text, so the result is text.
  let out = '';
  for (const token of tokenizeExpressions(value)) {
    out +=
      token.kind === 'literal'
        ? token.text
        : stringifyForTemplate(values.get(token.source));
  }
  return out;
}
