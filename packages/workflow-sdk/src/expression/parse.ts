/**
 * Compiling an expression, and refusing the ones that are not safe to run. The
 * only module that imports JSONata.
 *
 * Safety rests on two things. A `function(){}` literal is legal only as a
 * direct call argument, which removes every route to recursion, and `$eval` is
 * refused by name. `EXPRESSION_LIMITS` is the runtime guarantee behind both —
 * measured, not assumed: a long expression throws D1012 at the timeout.
 *
 */
import jsonata from 'jsonata';
import type { Expression, ExprNode } from 'jsonata';
import { EXPRESSION_ROOTS } from './format.js';
import { isBuiltin } from './signatures.js';

// ─── Runtime limits ───

/** Evaluation limits, applied at compile time and enforced by JSONata while evaluating. */
export const EXPRESSION_LIMITS = { timeout: 1000, stack: 200 } as const;

// ─── Compilation (cached) ───

/** Compiled-expression cache. */
const CACHE_MAX = 500;
const cache = new Map<string, Expression>();

/** Compile an expression source, memoized. */
export function compileExpression(source: string): Expression {
  const hit = cache.get(source);
  if (hit !== undefined) {
    // Re-insert so iteration order stays least-recently-used first.
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const compiled = jsonata(source, EXPRESSION_LIMITS);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(source, compiled);
  return compiled;
}

/** The parsed form of an expression, or null when it does not compile. */
export function expressionAst(source: string): ExprNode | null {
  try {
    return compileExpression(source).ast();
  } catch {
    return null;
  }
}

/** Drop every cached expression. For tests and long-idle hosts. */
export function clearExpressionCache(): void {
  cache.clear();
}

// ─── Safety ───

export type ExpressionFaultKind = 'syntax' | 'namedFunction' | 'eval' | 'unknownFunction';

export interface ExpressionFault {
  kind: ExpressionFaultKind;
  /** Author-facing, already specific enough to show as-is. */
  message: string;
  /** 0-based offset into the expression source, when the parser gave one. */
  position?: number;
}

/**
 * Walk every node of an AST, flagging which ones sit directly in a call's argument list.
 */
function walkAst(
  node: unknown,
  inArgumentList: boolean,
  visit: (node: Record<string, unknown>, inArgumentList: boolean) => void,
): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, false, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record, inArgumentList);

  const type = record['type'];
  for (const [key, value] of Object.entries(record)) {
    const isCallArguments =
      key === 'arguments' &&
      (type === 'function' || type === 'apply') &&
      Array.isArray(value);
    if (isCallArguments) {
      for (const argument of value as unknown[]) walkAst(argument, true, visit);
    } else {
      walkAst(value, false, visit);
    }
  }
}

/**
 * Check an expression for anything that must never run, without evaluating it.
 * Returns the first fault, or null when the expression is safe to keep.
 *
 * Two things are refused:
 *
 * **Naming a function.** A `lambda` is allowed only as a direct argument to a
 * call — `$filter(xs, function($x){ ... })` — and nowhere else. That one rule is
 * what makes evaluation terminate: an expression can only loop by calling
 * itself, calling itself needs a name to call, and the only ways to get a name
 * are to bind a lambda (`$f := function…`), to stash one in an array or object,
 * or to apply a lambda literal to itself. Every one of those puts a `lambda`
 * somewhere other than an argument slot, so all of them are caught — verified
 * against each form. Inline predicates, which is what the list functions
 * actually need, are untouched, and so is naming a plain *value*
 * (`$total := $sum(…)`), which cannot recurse.
 *
 * **`$eval`.** It compiles a string as a new expression, which is the one hole
 * through which everything above could be re-introduced. Matched on the
 * variable name wherever it appears, so an alias (`$g := $eval`) or a reference
 * (`$map(xs, $eval)`) is caught too, not just a direct call. AWS blocks it in
 * their JSONata support for the same reason.
 *
 * **Unknown functions.** A name JSONata does not have, so that a typo is caught
 * while writing rather than at `T1006`. This was skipped at first on the belief
 * that the builtins could not be enumerated — they can: every name JSONata binds
 * resolves to an object carrying its own signature, and
 * `jsonata-signatures.ts` is generated from them. Checked after the two bans so
 * that `$f(0)` beside a named function reports the named function, which is the
 * more useful of the two complaints.
 *
 * Note this assumes nothing is registered beyond the builtins. If the engine
 * ever calls `registerFunction`, those names have to be known here too, or
 * correct expressions will be refused.
 */
export function inspectExpression(source: string): ExpressionFault | null {
  let ast: ExprNode;
  try {
    ast = compileExpression(source).ast();
  } catch (err) {
    const error = err as { message?: string; position?: number };
    return {
      kind: 'syntax',
      message: error.message ?? 'This expression could not be read.',
      ...(typeof error.position === 'number' ? { position: error.position } : {}),
    };
  }

  let fault: ExpressionFault | null = null;
  walkAst(ast, false, (node, inArgumentList) => {
    if (fault) return;
    const position = node['position'];
    const at = typeof position === 'number' ? { position } : {};
    if (node['type'] === 'variable' && node['value'] === 'eval') {
      fault = { kind: 'eval', message: '$eval is not available in expressions.', ...at };
      return;
    }
    if (node['type'] === 'lambda' && !inArgumentList) {
      fault = {
        kind: 'namedFunction',
        message:
          'An expression cannot define a named function. Write the function directly where it is used, as in $filter(items, function($i){ $i.amount > 10 }).',
        ...at,
      };
    }
  });
  if (fault) return fault;

  // A second pass, so a banned construct is reported before a name that only
  walkAst(ast, false, (node) => {
    if (fault || node['type'] !== 'function') return;
    const procedure = node['procedure'];
    if (procedure === null || typeof procedure !== 'object') return;
    const name = (procedure as Record<string, unknown>)['value'];
    if (typeof name !== 'string' || isBuiltin(name)) return;
    const position = (procedure as Record<string, unknown>)['position'];
    fault = {
      kind: 'unknownFunction',
      message: `$${name} is not a function.`,
      ...(typeof position === 'number' ? { position } : {}),
    };
  });
  return fault;
}

// ─── References inside an expression ───

export const ROOTS: ReadonlySet<string> = new Set(EXPRESSION_ROOTS);

/** Dotted context paths an expression reads, e.g. */
export function refsInExpression(source: string): string[] {
  let ast: ExprNode;
  try {
    ast = compileExpression(source).ast();
  } catch {
    return [];
  }

  const found: string[] = [];
  walkAst(ast, false, (node) => {
    if (node['type'] !== 'path') return;
    const steps = node['steps'];
    if (!Array.isArray(steps) || steps.length === 0) return;

    const names: string[] = [];
    for (const step of steps) {
      if (step === null || typeof step !== 'object') return;
      const record = step as Record<string, unknown>;
      if (record['type'] !== 'name' || typeof record['value'] !== 'string') return;
      names.push(record['value']);
    }
    if (!ROOTS.has(names[0]!)) return;
    const path = names.join('.');
    if (!found.includes(path)) found.push(path);
  });
  return found;
}
