/**
 * Normalize library-produced values before writing them to a Prisma Json field.
 * JSON.stringify omits undefined object properties and converts undefined array
 * entries to null, matching JSON/JSONB semantics.
 */
export function toJsonSafeValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
