/**
 * What a form can describe: an argument, a call over arguments, and a list
 * rendered one item per line.
 *
 * The list is not a function composition — `f(g(x))` can never produce
 * `description & " = " & amount` — so it is a shape of its own.
 */
import { EXPRESSION_FUNCTIONS, expressionFunction, type ExpressionFunction } from '../catalogue.js';
import { paramAt } from '../signature.js';
import { baseKind, type ExprType } from '../types.js';

/** How a predicate compares. */
export const COMPARISON_OPS = [
  { op: '=', said: 'is' },
  { op: '!=', said: 'is not' },
  { op: '>', said: 'is more than' },
  { op: '>=', said: 'is at least' },
  { op: '<', said: 'is less than' },
  { op: '<=', said: 'is at most' },
] as const;

export type ComparisonOp = (typeof COMPARISON_OPS)[number]['op'];

/** Keep only the items whose `field` compares this way against `value`. */
export interface ItemFilter {
  field: string;
  op: ComparisonOp;
  /** As the author typed it. */
  value: string;
  /**
   * What the field being tested is declared to be, when anything declares it.
   *
   * Without it the value is spelled from its own shape, and a text field tested
   * against `10` becomes `[code = 10]` — which matches nothing, silently,
   * because `"10" = 10` is false. The form knows the field's type; this is how
   * it says so. Read back from how the literal was spelled, so the round trip
   * holds without the reader having to know the schema.
   */
  type?: ExprType | undefined;
}

/** One value going into a computation: where it is, narrowed, and read. */
export interface ValueSelection {
  /** A dotted path, with an explicit root. */
  path: string;
  /** Only some of the items. */
  filter?: ItemFilter | undefined;
  /** One field of each item, rather than the whole item. */
  field?: string | undefined;
}

/** One argument: data the author pointed at, or text they typed. */
export type Argument =
  | ({ kind: 'value' } & ValueSelection)
  | { kind: 'fixed'; raw: string }
  /** Several things where a list is wanted, written `[a, b]`. */
  | { kind: 'list'; of: Argument[] };

/** One catalogue entry over some arguments: `$sum([a, b])`, `a * b`. */
export interface Call {
  kind: 'call';
  /** A catalogue name — `$sum`, or `multiply` for an operator. */
  fn: string;
  args: Argument[];
}

/** Every item of a list, rendered as one piece of text. */
export interface ListFormat {
  kind: 'list';
  /** The list, optionally narrowed by a filter. */
  source: ValueSelection;
  /** What one item reads, with `{{field}}` standing for a field of that item. */
  template: string;
  /** Between one item and the next. */
  separator: string;
  /** What to say when the list is empty. */
  empty?: string | undefined;
}

/** A computation a form can describe. */
export type Computation = Call | ListFormat;

/** The operations a form can describe: no parameter wanting a function. */
export const FORMABLE_FUNCTIONS: readonly ExpressionFunction[] = EXPRESSION_FUNCTIONS.filter(
  // Only a *required* one disqualifies it. `$sort` is `<af?:a>` — it sorts on
  // its own and the comparator is for another order — so a form offers it and
  // leaves that argument off. `$filter` is `<af>`, with no such luck.
  (fn) => !fn.signature.params.some((p) => p.isFunction && !p.optional),
);

export function isFormable(fn: string): boolean {
  return FORMABLE_FUNCTIONS.some((entry) => entry.name === fn);
}

/**
 * How many arguments an entry takes, up to the first function parameter and
 * never past it — a control for one has no value that is not a T0410.
 */
export function argumentSlots(fn: string): { count: number } | null {
  const entry = expressionFunction(fn);
  if (!entry || !isFormable(fn)) return null;
  const upTo = entry.signature.params.findIndex((p) => p.isFunction);
  const count = upTo === -1 ? entry.signature.params.length : upTo;
  return count === 0 ? null : { count };
}

/** What the nth argument has to be. */
export function wantsAt(fn: string, at: number): ExprType {
  const entry = expressionFunction(fn);
  return entry === undefined ? 'unknown' : (paramAt(entry.signature, at)?.type ?? 'unknown');
}

/** Whether the nth argument is a list, and so takes as many entries as you like. */
export function takesSeveral(fn: string, at: number): boolean {
  return baseKind(wantsAt(fn, at)) === 'array';
}

/** The current item, inside the function `$map` is given. */
export const ITEM = '$i';
/** `{{a.b}}`, and the text around it. Global: it is walked with `matchAll`. */
export const PLACEHOLDER = /\{\{([^}]+)\}\}/g;
/**
 * The same thing, asked once.
 *
 * Separate because `.test()` on a global regex advances `lastIndex`, so the
 * shared one would answer differently each time it were asked.
 */
export const HAS_PLACEHOLDER = /\{\{[^}]+\}\}/;
