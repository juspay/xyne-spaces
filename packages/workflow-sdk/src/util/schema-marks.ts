/**
 * Facts a config field carries from its Zod declaration into the JSON Schema the
 * editor reads.
 *
 * Two of them cannot be said in JSON Schema's own vocabulary: that a field's
 * values can be listed by the component that owns it, and that a field also
 * accepts a `{{...}}` reference. Both are declared AT the field, in Zod, and
 * projected onto the generated document by `zod-to-json-schema`'s `postProcess`
 * hook, which fires once per converted node. The converter's own recursion does
 * all the walking, so nesting, arrays, arrays-of-objects and union variants need
 * no code here.
 *
 * They share one registry because `postProcess` takes exactly one callback. A
 * mark's name is the JSON Schema key it becomes, so nothing translates between
 * the two sides.
 *
 * This replaced a sentinel prefix stuffed into `description` — a field meant for
 * the author's own words, which the marker overwrote and every reader then had
 * to parse back out.
 */

import type { z } from 'zod';
import type { PostProcessCallback } from 'zod-to-json-schema';

/** Each becomes a boolean of the same name on the generated schema. */
export type SchemaMark = 'hasOptions' | 'isVariableRef';

const ALL_MARKS: readonly SchemaMark[] = ['hasOptions', 'isVariableRef'];

/**
 * The marks live ON the def, under a shared symbol, rather than in a table keyed
 * by def identity.
 *
 * Zod rebuilds a def for several ordinary operations — `.describe()` is
 * `new this.constructor({ ...this._def, description })` — so anything keyed on
 * the old object is silently dropped by `withOptions(z.string()).describe('…')`,
 * which is the order most people write. A symbol property is copied by that
 * spread, so the mark survives however the field is finished off.
 *
 * `Symbol.for` rather than a module-local symbol: a config schema is DECLARED in
 * a connector package and CONVERTED in this one, and were two copies of the SDK
 * ever loaded, a private symbol would make every mark invisible.
 */
const MARKS: unique symbol = Symbol.for('@xyne/workflow-sdk:schema-marks') as never;

interface MarkedDef {
  [MARKS]?: ReadonlySet<SchemaMark>;
}

/**
 * A copy of `inner` carrying `mark`.
 *
 * Copied rather than marked in place: a schema held in a `const` and reused
 * across several fields would otherwise light up every field it appears in.
 * Marks already on the original come along, so wrapping twice —
 * `withOptions(variableRef(x))` — keeps both.
 */
export function markSchema<T extends z.ZodTypeAny>(inner: T, mark: SchemaMark): T {
  const source = inner._def as MarkedDef;
  const def = { ...(inner._def as object) } as MarkedDef;
  // A fresh set, so two schemas grown from one never share a mutable value.
  const marks = new Set<SchemaMark>(source[MARKS] ?? []);
  marks.add(mark);
  def[MARKS] = marks;

  const Ctor = inner.constructor as unknown as new (d: unknown) => T;
  return new Ctor(def);
}

/** Whether this def's schema was marked. */
export function isMarked(def: object, mark: SchemaMark): boolean {
  return (def as MarkedDef)[MARKS]?.has(mark) === true;
}

/**
 * Declare that this field's values are drawn from a set the component can
 * enumerate — the difference between pasting a repository id and picking one.
 *
 * A suggestion, not a constraint. Free text and `{{trigger.x}}` references stay
 * legal, which is why this is not `z.enum` — it says where good values come
 * from, not which values are allowed. The component answers with `getOptions`,
 * and `ctx.field` tells it which field is asking.
 */
export function withOptions<T extends z.ZodTypeAny>(inner: T): T {
  return markSchema(inner, 'hasOptions');
}

/** Whether {@link withOptions} marked the schema this def belongs to. */
export function isOptionMarked(def: object): boolean {
  return isMarked(def, 'hasOptions');
}

/** Projects every mark a node carries onto the generated JSON Schema. */
export const applyMarks: PostProcessCallback = (jsonSchema, def) => {
  if (jsonSchema === undefined) return jsonSchema;

  const node = jsonSchema as Record<string, unknown>;
  let marked: Record<string, unknown> | undefined;

  for (const mark of ALL_MARKS) {
    if (node[mark] === true) continue;
    if (!carries(def, node, mark)) continue;
    marked = { ...(marked ?? node), [mark]: true };
  }

  return (marked ?? jsonSchema) as typeof jsonSchema;
};

function carries(def: object, node: Record<string, unknown>, mark: SchemaMark): boolean {
  return isMarked(def, mark) || variantMarked(node, mark) || innerMarked(def, mark);
}

/**
 * Whether a union variant carries the mark.
 *
 * `.nullable()` and `variableRef()` emit the field as an `anyOf`, which puts the
 * marked node one level below the property the editor reads. The field is still
 * the thing it was marked as, so the mark is lifted to where it will be seen.
 * Only a variant's OWN mark lifts — an object variant holding a marked property
 * does not make the object itself a picker.
 */
function variantMarked(node: Record<string, unknown>, mark: SchemaMark): boolean {
  for (const key of ['anyOf', 'oneOf']) {
    const variants = node[key];
    if (!Array.isArray(variants)) continue;
    const any = variants.some(
      (variant) =>
        typeof variant === 'object' &&
        variant !== null &&
        (variant as Record<string, unknown>)[mark] === true,
    );
    if (any) return true;
  }
  return false;
}

/**
 * Whether a modifier is wrapping a marked schema.
 *
 * `.optional()`, `.nullable()` and `.default()` each decide for themselves which
 * node reaches the output: optional emits the INNER type's node and records the
 * name in `required`, while a nullable primitive collapses to
 * `type: ['string','null']` emitted from the OUTER def. So neither "wrap
 * innermost" nor "wrap outermost" is universally right, and an author should not
 * have to know which is which — the mark is looked for in both directions
 * instead.
 *
 * Bounded at three wrappers: `.optional().nullable().default(x)` is already more
 * than a config field should need, and an unbounded walk over internals is a
 * cost paid on every conversion.
 */
function innerMarked(def: object, mark: SchemaMark): boolean {
  let current: object = def;
  for (let depth = 0; depth < 3; depth += 1) {
    const inner = (current as { innerType?: { _def?: unknown } }).innerType?._def;
    if (typeof inner !== 'object' || inner === null) return false;
    if (isMarked(inner, mark)) return true;
    current = inner;
  }
  return false;
}

/**
 * Whether any field in a converted schema offers choices.
 *
 * Asks the generated JSON Schema rather than the Zod tree, because that is what
 * the editor reads: a mark that failed to survive conversion is not a picker,
 * whatever the declaration said.
 */
export function schemaOffersOptions(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(schemaOffersOptions);
  if (typeof node !== 'object' || node === null) return false;
  const record = node as Record<string, unknown>;
  if (record['hasOptions'] === true) return true;
  return Object.values(record).some(schemaOffersOptions);
}
