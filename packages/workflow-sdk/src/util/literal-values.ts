/**
 * Stripping `{{…}}` references out of a config.
 *
 * The runtime counterpart of `Literal<T>`: that type describes what is left, and
 * this produces it. They live together because they have to agree — a type
 * saying a key may be absent is only honest if something actually removes it.
 *
 * Used wherever a component is asked about values it could act on NOW: narrowing
 * a picker, checking a configuration. The editor keeps its own copy of this rule
 * for its query cache; if the two ever disagree, the cache stops reflecting what
 * the loader sees.
 */

/**
 * The fields whose values are actually known while editing.
 *
 * A sibling field may hold `{{trigger.projectId}}` — a promise about run time,
 * not an id. A loader filtering by it would search for the literal text and
 * quietly find nothing, so references are dropped here and offered separately as
 * `config` for the rare loader that wants the raw text.
 */
export function literalValues(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isPlainObject(value)) {
      // Follow the form as deep as a field path can go: `repository.id` is a
      // usable filter even when its neighbour `repository.name` is a reference.
      out[key] = literalValues(value);
      continue;
    }
    if (holdsRef(value)) continue;
    out[key] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is waiting on run time anywhere inside it.
 *
 * An array is all-or-nothing: dropping the one element that holds a reference
 * would hand the loader a shorter list and no sign that it is short, which reads
 * as a narrower filter rather than an unanswerable one.
 */
function holdsRef(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('{{');
  if (Array.isArray(value)) return value.some(holdsRef);
  if (isPlainObject(value)) return Object.values(value).some(holdsRef);
  return false;
}
