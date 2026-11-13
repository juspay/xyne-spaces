/**
 * Types as an expression sees them: a {@link TypeKind} plus one level of "a
 * list of". Anything deeper is `unknown`, a wildcard at every depth.
 *
 * Two assignability rules, and the difference is the point: a *field* coerces,
 * because the runtime stringifies whatever lands in it, and an *argument* does
 * not, because JSONata answers a mismatched parameter with T0410.
 */
import type { TypeKind } from '../util/type-compat.js';

/** The type of a value an expression reads or produces. */
export type ExprType = TypeKind | { readonly array: ExprType };


/** `array<number>` → `'array'`. What a field-level check compares. */
export function baseKind(type: ExprType): TypeKind {
  return typeof type === 'string' ? type : 'array';
}

/** `array<number>` → `number`; anything else → `unknown`. */
export function elementType(type: ExprType): ExprType {
  return typeof type === 'string' ? 'unknown' : type.array;
}

/** Spell a type the way an author would read it: `list of numbers`. */
export function sayType(type: ExprType): string {
  if (typeof type !== 'string') return `list of ${sayType(type.array)}s`;
  switch (type) {
    case 'string':
      return 'text';
    case 'boolean':
      return 'true/false';
    case 'array':
      return 'list';
    default:
      return type;
  }
}

/** Can an expression's result be bound into a field of this type? */
export function assignableToField(source: ExprType, target: ExprType): boolean {
  if (source === 'unknown' || target === 'unknown') return true;
  const from = baseKind(source);
  const to = baseKind(target);
  if (from === 'array' && to === 'array') {
    return assignableToField(elementType(source), elementType(target));
  }
  if (to === 'string') return true; // the sink: the runtime stringifies into text
  if (from === 'scalar' || to === 'scalar') return true; // coarsened, unverifiable
  return from === to;
}

/**
 * Can a value of this type be passed as a function argument?
 *
 * **Deliberately stricter than {@link assignableToField}, and this distinction
 * is the point:** a field coerces, a function does not. The runtime stringifies
 * whatever lands in a text field, which is why `kindsCompatible` lets anything
 * into a `string` target — but JSONata performs no such favour for a parameter.
 * `$uppercase(someNumber)` is a hard `T0410` at runtime, and going by the field
 * rule would have declared it fine.
 *
 * So: kinds must match. `unknown` is still a wildcard at every depth, and
 * `scalar` — the coarsening bucket for enums, literals and dates — is treated as
 * unverifiable rather than as a mismatch.
 *
 * ## One value where a list is wanted
 *
 * The exception, and it is JSONata's rather than ours: an `a<T>` parameter
 * **wraps** a single value in a list rather than refusing it, so `$sum(5)` is 5
 * and `$reverse(5)` is `[5]`. Only the element type is enforced — `$sum("x")`
 * is still a `T0412`.
 *
 * Refusing it here would have been wrong twice over. `$sum(items.amount)` is
 * the expression this whole feature exists for, and a type lookup coarse enough
 * to call `items.amount` a number — which any picker tree carrying JSON-Schema
 * `type` keywords does — would see a fault in it. And a filter that matches one
 * item returns that item rather than a list of one, so `$sum(items[id = 3].n)`
 * is a *scalar* at runtime whenever it matches once. Both are valid; neither may
 * be flagged.
 */
export function assignableToArgument(source: ExprType, target: ExprType): boolean {
  if (source === 'unknown' || target === 'unknown') return true;
  const from = baseKind(source);
  const to = baseKind(target);
  if (to === 'array') {
    // A list is compared element-wise; one value is compared against the
    return assignableToArgument(from === 'array' ? elementType(source) : source, elementType(target));
  }
  if (from === 'scalar' || to === 'scalar') return true;
  return from === to;
}

/**
 * The one type that describes every branch — for an array literal, or the two arms of a condition.
 */
export function unify(types: readonly ExprType[]): ExprType {
  if (types.length === 0) return 'unknown';
  return types.reduce((a, b) => {
    if (a === 'unknown' || b === 'unknown') return 'unknown';
    if (typeof a !== 'string' && typeof b !== 'string') {
      const inner = unify([a.array, b.array]);
      return inner === 'unknown' ? ('array' as ExprType) : { array: inner };
    }
    if (typeof a === 'string' && typeof b === 'string') return a === b ? a : 'unknown';
    return 'unknown';
  });
}

/**
 * A literal as JSONata source, written **as the parameter wants it** rather
 * than as it looks.
 *
 * Guessing from the text is unsafe in both directions, and both were measured:
 * `$replace("a2c", 2, "X")` is a `T0410` because argument 2 must be text, and
 * `$round(1.234, "2")` is a `T0410` because argument 2 must be a number. The
 * same four characters have to be written two different ways depending on where
 * they land, so only the signature can decide.
 *
 * `null` when the text cannot be that type — `abc` is not a number. The caller
 * refuses to write anything rather than emitting something that fails at
 * runtime, in front of a customer.
 */
export function writeLiteralAs(raw: string, want: ExprType): string | null {
  const text = raw.trim();
  if (text === '') return null;
  const kind = baseKind(want);

  if (kind === 'string') return JSON.stringify(raw);
  if (kind === 'number') {
    const n = Number(text);
    return text !== '' && Number.isFinite(n) ? String(n) : null;
  }
  if (kind === 'boolean') {
    if (text === 'true' || text === 'false') return text;
    return null;
  }
  // An array or object literal is not something a one-line box can say, and
  if (kind === 'array' || kind === 'object') return null;

  // Nothing declared — either genuinely any (`x`), or a union the notation
  // collapses, like `$replace`'s `(sf)`. Text, rather than a guess from the
  // shape: text is what a box someone types in produces, every parameter that
  // declares nothing accepts it, and guessing is the exact mistake that had
  // `$replace(x, 2, "X")` failing with a T0410.
  return JSON.stringify(raw);
}
