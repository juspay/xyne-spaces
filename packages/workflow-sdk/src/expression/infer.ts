/**
 * What an expression will produce, worked out from the references in it and the
 * signatures of the functions it calls.
 *
 * Silent rather than wrong: anything unreadable is `unknown`, a wildcard at
 * every depth, so the checker never refuses an expression that would have run.
 */
// Type only — erased at compile time, so this module adds no engine.
import type { ExprNode } from 'jsonata';
import { ROOTS, compileExpression } from './parse.js';
import { builtinSignature } from './signatures.js';
import { paramAt, parseSignature } from './signature.js';
import { assignableToArgument, baseKind, elementType, sayType, unify, type ExprType } from './types.js';

// ─── Type inference ───

export interface TypeFault {
  /** Author-facing, specific enough to show as-is. */
  message: string;
  /** 0-based offset into the expression source, when the parser gave one. */
  position?: number;
}

export interface InferredExpression {
  /** What the whole expression produces — `unknown` wherever it cannot be read. */
  type: ExprType;
  /** Arguments passed something their function cannot accept. */
  faults: TypeFault[];
}

/** Arithmetic that only makes sense on numbers. */
const NUMERIC_OPERATORS = new Set(['+', '-', '*', '/', '%']);
/** Comparisons and tests, whatever they are given. */
const BOOLEAN_OPERATORS = new Set(['=', '!=', '<', '<=', '>', '>=', 'in', 'and', 'or']);

function at(node: Record<string, unknown>): { position?: number } {
  const position = node['position'];
  return typeof position === 'number' ? { position } : {};
}

/** The dotted path a `path` node names, or null when it is not a plain one. */
function dottedPath(node: Record<string, unknown>): string | null {
  const steps = node['steps'];
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const names: string[] = [];
  for (const step of steps) {
    if (step === null || typeof step !== 'object') return null;
    const record = step as Record<string, unknown>;
    if (record['type'] !== 'name' || typeof record['value'] !== 'string') return null;
    names.push(record['value']);
  }
  return ROOTS.has(names[0]!) ? names.join('.') : null;
}

/**
 * Work out what an expression produces, and what it misuses on the way.
 *
 * This is what makes the typing claim true *before* a run. Without it the
 * engine leans entirely on JSONata's own signature checks (`T0410`, `T0412`) and
 * on zod rejecting the result — both correct, both too late, and neither
 * visible while the workflow is being written.
 *
 * ## It is only ever allowed to be silent, never wrong
 *
 * Every node it cannot read yields `unknown`, which {@link assignableToArgument}
 * and {@link assignableToField} treat as compatible at any depth. A relative
 * path inside a predicate, a lambda parameter, a `$$`, a regex, an unrecognised
 * node from a future JSONata — all `unknown`. That asymmetry is deliberate: a
 * missed mistake costs a runtime error the author would have had anyway, while a
 * false one blocks a correct workflow from being saved. Expression typing is a
 * courtesy on top of a dynamically-checked language, not a gate.
 *
 * ## Where the types come from
 *
 * References resolve through `lookup`, which the caller supplies — the validator
 * reads JSON Schema, a test can hand over a map. This module never sees a
 * schema, for the same reason `type-compat` does not: the two schema worlds
 * (Zod here, JSON Schema across the wire) must not leak into the rule.
 */
export function inferExpressionType(
  source: string,
  lookup: (path: string) => ExprType | undefined,
): InferredExpression {
  let ast: ExprNode;
  try {
    ast = compileExpression(source).ast();
  } catch {
    return { type: 'unknown', faults: [] };
  }

  const faults: TypeFault[] = [];

  const infer = (value: unknown): ExprType => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
    const node = value as Record<string, unknown>;

    switch (node['type']) {
      case 'number':
        return 'number';
      case 'string':
        return 'string';
      case 'value':
        // `true` / `false` / `null`; only the first two have a type worth saying.
        return node['value'] === null ? 'unknown' : 'boolean';

      case 'path': {
        const path = dottedPath(node);
        return path === null ? 'unknown' : (lookup(path) ?? 'unknown');
      }

      case 'unary': {
        if (node['value'] === '[') {
          const items = node['expressions'];
          if (!Array.isArray(items)) return 'array';
          // JSONata flattens: `[theList]` is `theList`, and `[1..5]` is a flat
          const inner = unify(
            items.map((item) => {
              const type = infer(item);
              return baseKind(type) === 'array' ? elementType(type) : type;
            }),
          );
          return inner === 'unknown' ? 'array' : { array: inner };
        }
        if (node['value'] === '{') return 'object';
        if (node['value'] === '-') return 'number';
        return 'unknown';
      }

      case 'binary': {
        const op = node['value'];
        if (typeof op !== 'string') return 'unknown';
        if (op === '..') return { array: 'number' };
        if (op === '&') return 'string';
        if (BOOLEAN_OPERATORS.has(op)) {
          infer(node['lhs']);
          infer(node['rhs']);
          return 'boolean';
        }
        if (NUMERIC_OPERATORS.has(op)) {
          for (const side of ['lhs', 'rhs'] as const) {
            const operand = infer(node[side]);
            if (!assignableToArgument(operand, 'number')) {
              faults.push({
                message: `"${op}" needs numbers, but one side is ${sayType(operand)}.`,
                ...at(node),
              });
            }
          }
          return 'number';
        }
        return 'unknown';
      }

      case 'condition':
        return unify([infer(node['then']), infer(node['else'])]);

      case 'block': {
        const parts = node['expressions'];
        if (!Array.isArray(parts) || parts.length === 0) return 'unknown';
        // Every part runs, but only the last one is the answer.
        for (const part of parts.slice(0, -1)) infer(part);
        return infer(parts[parts.length - 1]);
      }

      case 'apply': {
        // `a ~> $sum()` — the left side becomes the call's first argument.
        const rhs = node['rhs'];
        const piped = infer(node['lhs']);
        if (rhs === null || typeof rhs !== 'object') return 'unknown';
        const record = rhs as Record<string, unknown>;
        if (record['type'] === 'variable') {
          return callType({ procedure: record, arguments: [] }, piped);
        }
        return callType(record, piped);
      }

      case 'function':
      case 'partial':
        return callType(node, undefined);

      default:
        // `lambda`, `variable`, `bind`, `regex`, `wildcard`, `descendant`,
        return 'unknown';
    }
  };

  /**
   * A call's result, with every argument checked against the signature JSONata publishes for it.
   */
  const callType = (node: Record<string, unknown>, piped: ExprType | undefined): ExprType => {
    const procedure = node['procedure'];
    const name =
      procedure !== null && typeof procedure === 'object'
        ? (procedure as Record<string, unknown>)['value']
        : undefined;
    if (typeof name !== 'string') return 'unknown';

    const args = Array.isArray(node['arguments']) ? (node['arguments'] as unknown[]) : [];
    // Walk every argument so faults inside them are still reported, but give a
    const argTypes = args.map((argument) => {
      const record = argument as Record<string, unknown> | null;
      if (record !== null && typeof record === 'object' && record['type'] === 'lambda') {
        return 'unknown' as ExprType;
      }
      return infer(argument);
    });

    const definition = builtinSignature(name);
    const signature = definition === undefined ? null : parseSignature(definition);
    if (signature === null) return 'unknown'; // unknown name, or notation we cannot read

    const supplied = piped === undefined ? argTypes : [piped, ...argTypes];
    supplied.forEach((type, index) => {
      const param = paramAt(signature, index);
      if (param === undefined) return;
      if (assignableToArgument(type, param.type)) return;
      const which = supplied.length > 1 ? ` for argument ${String(index + 1)}` : '';
      faults.push({
        message: `$${name} needs ${sayType(param.type)}${which}, but this is ${sayType(type)}.`,
        ...at(node),
      });
    });
    return signature.returns;
  };

  return { type: infer(ast), faults };
}
