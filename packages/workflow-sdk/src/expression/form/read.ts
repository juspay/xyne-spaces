/**
 * An expression back into the computation that wrote it.
 *
 * `null` for anything else — hand-written, or a shape a later version produced
 * — so a form opens empty and says so rather than guessing.
 */
import { expressionAst } from '../parse.js';
import { extractExpressionSource, EXPRESSION_ROOTS } from '../format.js';
import type { ExprType } from '../types.js';
import { EXPRESSION_FUNCTIONS } from '../catalogue.js';
import {
  COMPARISON_OPS,
  HAS_PLACEHOLDER,
  ITEM,
  argumentSlots,
  takesSeveral,
  type Argument,
  type Call,
  type Computation,
  type ItemFilter,
  type ListFormat,
  type ValueSelection,
} from './model.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A `path` node as names plus its one filter stage, when it is a plain path. */
function readPath(node: unknown): { names: string[]; stages: unknown } | null {
  if (!isRecord(node) || node['type'] !== 'path') return null;
  const steps = node['steps'];
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const names: string[] = [];
  let stages: unknown;
  for (const step of steps) {
    if (!isRecord(step) || step['type'] !== 'name' || typeof step['value'] !== 'string') {
      return null;
    }
    names.push(step['value']);
    // A form writes at most one predicate, on the list itself.
    if (step['stages'] !== undefined) {
      if (stages !== undefined) return null;
      stages = step['stages'];
    }
  }
  return { names, stages };
}

/** `[tag = "fee"]` back into the three controls that produced it. */
function readFilter(stages: unknown): ItemFilter | null {
  if (!Array.isArray(stages) || stages.length !== 1) return null;
  const stage = stages[0];
  if (!isRecord(stage) || stage['type'] !== 'filter') return null;
  const expr = stage['expr'];
  if (!isRecord(expr) || expr['type'] !== 'binary') return null;
  const comparison = COMPARISON_OPS.find((candidate) => candidate.op === expr['value']);
  const left = readPath(expr['lhs']);
  const right = expr['rhs'];
  if (!comparison || !left || left.stages !== undefined || !isRecord(right)) return null;
  const spelling = String(right['type']);
  if (!['string', 'number', 'value'].includes(spelling)) return null;
  // How it was spelled *is* what the field was taken to be, so re-opening and
  const type: ExprType =
    spelling === 'string' ? 'string' : spelling === 'number' ? 'number' : 'boolean';
  return {
    field: left.names.join('.'),
    op: comparison.op,
    value: String(right['value']),
    type,
  };
}

/** One argument back into a selection. */
function readSelection(node: unknown, isList: (path: string) => boolean): ValueSelection | null {
  const path = readPath(node);
  if (!path) return null;

  // A trailing name is a field read off each item — but only when what precedes
  const whole = path.names.join('.');
  if (path.stages === undefined && isList(whole)) return { path: whole };

  const head = path.names.slice(0, -1).join('.');
  const plucked = path.names.length > 1 && isList(head);
  const selection: ValueSelection = {
    path: plucked ? head : whole,
    ...(plucked ? { field: path.names[path.names.length - 1]! } : {}),
  };

  if (path.stages === undefined) return selection;
  const filter = readFilter(path.stages);
  return filter === null ? null : { ...selection, filter };
}

/** Recover a computation from an expression this could have written. */
export function readComputation(
  expression: string,
  isList: (path: string) => boolean,
): Computation | null {
  const source = extractExpressionSource(expression);
  if (source === null) return null;
  const ast = expressionAst(source);
  // The list shape first: it is the more specific one, and its `$join(…)` top
  return readList(ast, isList) ?? readCall(ast, isList);
}

/** A literal string, or `null` for any other node. */
const readString = (node: unknown): string | null =>
  isRecord(node) && node['type'] === 'string' && typeof node['value'] === 'string'
    ? node['value']
    : null;

/** A call to this one builtin, as its arguments. */
function readBuiltin(node: unknown, name: string): unknown[] | null {
  if (!isRecord(node) || node['type'] !== 'function') return null;
  const procedure = node['procedure'];
  if (!isRecord(procedure) || procedure['value'] !== name) return null;
  return Array.isArray(node['arguments']) ? node['arguments'] : [];
}

/** `$i.amount.amount` back into `amount.amount` — a field of the current item. */
function readItemPath(node: unknown): string | null {
  if (!isRecord(node) || node['type'] !== 'path') return null;
  const steps = node['steps'];
  if (!Array.isArray(steps) || steps.length < 2) return null;
  const [head, ...rest] = steps;
  if (!isRecord(head) || head['type'] !== 'variable' || head['value'] !== ITEM.slice(1)) {
    return null;
  }
  const names: string[] = [];
  for (const step of rest) {
    if (!isRecord(step) || step['type'] !== 'name' || typeof step['value'] !== 'string') {
      return null;
    }
    if (step['stages'] !== undefined) return null;
    names.push(step['value']);
  }
  return names.join('.');
}

/** `function($i){ … }`'s real body. The parser wraps it in a thunk. */
function readItemFunction(node: unknown): unknown {
  if (!isRecord(node) || node['type'] !== 'lambda') return null;
  const params = node['arguments'];
  if (!Array.isArray(params) || params.length !== 1) return null;
  const only = params[0];
  if (!isRecord(only) || only['type'] !== 'variable' || only['value'] !== ITEM.slice(1)) {
    return null;
  }
  const body = node['body'];
  return isRecord(body) && body['thunk'] === true ? body['body'] : body;
}

/** One item's text back into the template that wrote it. */
function readTemplate(node: unknown): string | null {
  const links: unknown[] = [];
  const flatten = (current: unknown): boolean => {
    if (isRecord(current) && current['type'] === 'binary' && current['value'] === '&') {
      return flatten(current['lhs']) && flatten(current['rhs']);
    }
    links.push(current);
    return true;
  };
  if (!flatten(node)) return null;

  const out: string[] = [];
  for (const link of links) {
    const literal = readString(link);
    if (literal !== null) {
      // A literal that itself contains `{{…}}` would read back as a
      if (HAS_PLACEHOLDER.test(literal)) return null;
      out.push(literal);
      continue;
    }
    const shown = readBuiltin(link, 'string');
    if (shown === null || shown.length !== 1) return null;
    const path = readItemPath(shown[0]) ?? readOuterPath(shown[0]);
    if (path === null) return null;
    out.push(`{{${path}}}`);
  }
  return out.join('');
}

/** A path that names a known root — the workflow's value, not the item's. */
function readOuterPath(node: unknown): string | null {
  const path = readPath(node);
  if (path === null || path.stages !== undefined) return null;
  const root = path.names[0] ?? '';
  return (EXPRESSION_ROOTS as readonly string[]).includes(root) ? path.names.join('.') : null;
}

function readList(ast: unknown, isList: (path: string) => boolean): ListFormat | null {
  let node: unknown = ast;
  let empty: string | undefined;

  // The empty guard, when one was written: `$count(src) = 0 ? "…" : …`.
  if (isRecord(node) && node['type'] === 'condition') {
    const said = readString(node['then']);
    const test = node['condition'];
    if (said === null || !isRecord(test) || test['type'] !== 'binary' || test['value'] !== '=') {
      return null;
    }
    const zero = test['rhs'];
    if (!isRecord(zero) || zero['value'] !== 0) return null;
    if (readBuiltin(test['lhs'], 'count') === null) return null;
    empty = said;
    node = node['else'];
  }

  const joined = readBuiltin(node, 'join');
  if (joined === null || joined.length !== 2) return null;
  const separator = readString(joined[1]);
  if (separator === null) return null;

  const mapped = readBuiltin(joined[0], 'map');
  if (mapped === null || mapped.length !== 2) return null;
  const source = readSelection(mapped[0], isList);
  // The source is the list itself; a field of each item is the call shape.
  if (source === null || source.field !== undefined) return null;

  const template = readTemplate(readItemFunction(mapped[1]));
  if (template === null) return null;

  return {
    kind: 'list',
    source,
    template,
    separator,
    ...(empty === undefined ? {} : { empty }),
  };
}

/** A literal node back into the text that was typed into the box. */
function readFixed(node: unknown): Argument | null {
  if (!isRecord(node)) return null;
  const value = node['value'];
  if (node['type'] === 'string' && typeof value === 'string') return { kind: 'fixed', raw: value };
  if (node['type'] === 'number' && typeof value === 'number') {
    return { kind: 'fixed', raw: String(value) };
  }
  if (node['type'] === 'value' && (value === true || value === false)) {
    return { kind: 'fixed', raw: String(value) };
  }
  // `-3` parses as a negation of 3 rather than as one number.
  if (node['type'] === 'unary' && node['value'] === '-') {
    const inner = readFixed(node['expression']);
    return inner?.kind === 'fixed' ? { kind: 'fixed', raw: `-${inner.raw}` } : null;
  }
  return null;
}

/** One argument back: a list, a literal, or something pointed at. */
function readArgument(
  node: unknown,
  isList: (path: string) => boolean,
  several = false,
): Argument | null {
  // `[a, b]` only where a list is wanted; anywhere else it is an array literal
  if (several && isRecord(node) && node['type'] === 'unary' && node['value'] === '[') {
    const elements = Array.isArray(node['expressions']) ? node['expressions'] : [];
    const of = elements.map((element) => readArgument(element, isList));
    return of.every((a): a is Argument => a !== null) ? { kind: 'list', of } : null;
  }
  const fixed = readFixed(node);
  if (fixed !== null) return fixed;
  const selection = readSelection(node, isList);
  return selection === null ? null : { kind: 'value', ...selection };
}

function readCall(ast: unknown, isList: (path: string) => boolean): Call | null {
  if (!isRecord(ast)) return null;

  // An operator — `a * b` — which is a binary node, not a call.
  if (ast['type'] === 'binary') {
    const entry = EXPRESSION_FUNCTIONS.find((fn) => fn.infix === ast['value']);
    if (!entry) return null;
    const args = [readArgument(ast['lhs'], isList), readArgument(ast['rhs'], isList)];
    return args.every((a): a is Argument => a !== null)
      ? { kind: 'call', fn: entry.name, args }
      : null;
  }

  if (ast['type'] !== 'function') return null;
  const procedure = ast['procedure'];
  const fn = isRecord(procedure) ? `$${String(procedure['value'])}` : '';
  const slots = argumentSlots(fn);
  if (!slots) return null;

  const given = Array.isArray(ast['arguments']) ? ast['arguments'] : [];
  // Fewer than the slots is a call with its optional arguments left off, which
  if (given.length > slots.count) return null;

  const args = given.map((argument, at) => readArgument(argument, isList, takesSeveral(fn, at)));
  return args.every((a): a is Argument => a !== null) ? { kind: 'call', fn, args } : null;
}
