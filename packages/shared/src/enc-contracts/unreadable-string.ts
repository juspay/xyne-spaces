import { z } from 'zod';

const REDACTED = '<redacted>';

/** The wrapped strings, keyed by wrapper: nothing on the wrapper itself holds or shows them. */
const values = new WeakMap<object, string>();

/**
 * A string code may carry but not read. Printing, concatenating, JSON-serializing or
 * inspecting it gives `<redacted>`, and it has none of a string's members, so reading it
 * without `reveal()` is a compile error. This guards against accidental exposure (logs, error
 * payloads, responses); it is not a boundary against code that calls `reveal()`.
 */
export class UnreadableString {
  /** Makes the type nominal; never set. */
  declare private readonly unreadable: true;

  private constructor() {}

  static make(value: string): UnreadableString {
    const wrapper = new UnreadableString();
    values.set(wrapper, value);
    return wrapper;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}

// What console.log and util.inspect print in Node; looked up by name so this file has no Node import.
Object.defineProperty(UnreadableString.prototype, Symbol.for('nodejs.util.inspect.custom'), {
  value: () => `UnreadableString(${REDACTED})`,
});

/** The wrapped string. The one way to read an `UnreadableString`; each call site is a place the value is exposed. */
export function reveal(wrapper: UnreadableString): string {
  if (!values.has(wrapper)) throw new TypeError('reveal() needs an UnreadableString');
  return values.get(wrapper) as string;
}

/**
 * Whether an optional text field carries any characters, for a contract's "one of these is
 * required" checks: `!!value` would be true for every `UnreadableString`, even an empty one.
 * Reads only the length, never the content (a ciphertext of "" is not empty, as before).
 */
export function hasText(value: string | UnreadableString | null | undefined): boolean {
  if (value instanceof UnreadableString) return (values.get(value) ?? '').length > 0;
  return !!value;
}

const unreadableSchemas = new WeakSet<object>();

/**
 * Marks a contract field as unreadable: `content: unreadableString()`. The field is validated
 * as `schema` (any string by default) and handed to the handler as `UnreadableString` (see
 * `makeUnreadable`). Chain `.optional()` / `.nullable()` after it.
 */
export function unreadableString(schema: z.ZodType<string, string> = z.string()) {
  const marked = schema.transform((value) => UnreadableString.make(value));
  unreadableSchemas.add(marked);
  return marked;
}

/** Whether a field schema is `unreadableString()`, looking through `.optional()`, `.nullable()` and `.default()`. */
export function isUnreadableSchema(schema: unknown): boolean {
  let current = schema;
  while (current && typeof current === 'object') {
    if (unreadableSchemas.has(current)) return true;
    current = (current as { def?: { innerType?: unknown } }).def?.innerType;
  }
  return false;
}
