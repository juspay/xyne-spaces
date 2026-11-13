/**
 * Turning a multipart request's fields into the values a schema asks for.
 *
 * Every multipart field arrives as a string whatever it represents, so a
 * contract wanting a number, a list or an object needs its value re-read. The
 * one case a blanket `JSON.parse` gets wrong is a field the contract declares
 * as a *string*: it would turn `"7003"` into a number and `"null"` into
 * nothing, failing a sender that satisfied the contract exactly.
 *
 * Shared because both inbound multipart paths — a trigger and a wait callback —
 * face the identical problem, and solving it twice is how they came to disagree.
 */

/** Set `key`, keeping repeats of the same field as a list. */
export function addMultipartValue(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const current = payload[key];
  if (current === undefined) payload[key] = value;
  else if (Array.isArray(current)) current.push(value);
  else payload[key] = [current, value];
}

/**
 * Re-read a multipart request's text fields against the schema that describes
 * them. A field the schema declares as a string is left exactly as sent; an
 * undeclared one is parsed, since nothing says it shouldn't be.
 */
export function coerceTextFields(
  payload: unknown,
  schema: Record<string, unknown> | undefined,
): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const props = schema?.['properties'];
  const declared =
    props !== null && typeof props === 'object' && !Array.isArray(props)
      ? (props as Record<string, Record<string, unknown> | undefined>)
      : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] = reread(value, declared[key]);
  }
  return out;
}

function reread(value: unknown, prop: Record<string, unknown> | undefined): unknown {
  if (Array.isArray(value)) {
    const items = prop?.['items'];
    const itemProp =
      items !== null && typeof items === 'object' && !Array.isArray(items)
        ? (items as Record<string, unknown>)
        : undefined;
    return value.map((entry) => reread(entry, itemProp));
  }
  if (typeof value !== 'string') return value;
  if (prop?.['type'] === 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}
