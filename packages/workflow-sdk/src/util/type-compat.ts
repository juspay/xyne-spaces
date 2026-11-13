/**
 * How types are compared. `TypeKind` for a single value, `ExprType` to say "a
 * list of" one level down; everything deeper is `unknown`.
 *
 * Two assignability rules, and the difference is the point: a *field* coerces,
 * because the runtime stringifies whatever lands in it, and an *argument* does
 * not, because JSONata answers a mismatched parameter with T0410.
 */
export const TYPE_KINDS = [
  'string',
  'number',
  'boolean',
  'array',
  'object',
  // `scalar` is an intentional coarsening bucket (enum / literal / date) so the
  'scalar',
  // `unknown` = freeform / no declared type / union — unverifiable, so wildcard.
  'unknown',
] as const;

export type TypeKind = (typeof TYPE_KINDS)[number];

const SCALAR_KINDS = new Set<TypeKind>(['string', 'number', 'boolean', 'scalar']);

/** Can a value of `source` kind be bound into a `target` (consumer) kind field? */
export function kindsCompatible(source: TypeKind, target: TypeKind): boolean {
  if (source === 'unknown' || target === 'unknown') return true;
  if (target === 'string') return true;
  if (source === target) return true;
  return SCALAR_KINDS.has(source) && SCALAR_KINDS.has(target);
}

// ─── Expression types ───

/** A JSON-Schema `type` keyword as a {@link TypeKind}. */
export function kindOfJsonType(type: string | undefined): TypeKind {
  switch (type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'string':
    case 'boolean':
    case 'array':
    case 'object':
      return type;
    default:
      return 'unknown';
  }
}
