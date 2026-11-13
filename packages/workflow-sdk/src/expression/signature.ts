/**
 * Reads JSONata's signature notation — `<a<n>:n>` is "a list of numbers, giving
 * a number".
 *
 * Written here because JSONata's own parser is bundled with no import path to
 * it, and no standalone package exists; the Go port wrote its own and the Rust
 * one dropped signatures entirely. What *is* reachable, `signature.validate`,
 * checks values, and author-time checking has types and no values.
 *
 *   s n b l o a f   string, number, boolean, null, object, array, function
 *   u j x           some scalar, any JSON, anything
 *   a<T>            a list of T — the distinction the checker rests on
 *   (sf)            either; read as `unknown`
 *   - ? +           from context, optional, variadic
 */
import type { ExprType } from './types.js';

export interface SignatureParam {
  type: ExprType;
  /** Declared `?` — absent is fine. */
  optional: boolean;
  /** Declared `+` — this type, one or more times, to the end of the call. */
  variadic: boolean;
  /**
   * Declared `-` — JSONata may supply this argument from the context when it is left out.
   */
  fromContext: boolean;
  /** Declared `f` — this argument is a function. */
  isFunction: boolean;
}

export interface Signature {
  params: SignatureParam[];
  /** `unknown` when the signature declares no return, as `<af>` does. */
  returns: ExprType;
}

/** One type, from `at`, and where reading it finished. */
function readType(
  definition: string,
  at: number,
): { type: ExprType; next: number; isFunction?: boolean } | null {
  const char = definition[at];
  if (char === undefined) return null;
  let i = at + 1;

  // Either of several things — not describable, so not checked.
  if (char === '(') {
    for (let depth = 1; i < definition.length && depth > 0; i++) {
      if (definition[i] === '(') depth++;
      else if (definition[i] === ')') depth--;
    }
    return { type: 'unknown', next: i };
  }

  if (char === 'a') {
    if (definition[i] !== '<') return { type: 'array', next: i };
    const inner = readType(definition, i + 1);
    if (inner === null || definition[inner.next] !== '>') return null;
    return { type: { array: inner.type }, next: inner.next + 1 };
  }

  if (char === 'f') {
    // A function, possibly with a signature of its own. Nothing in this
    if (definition[i] === '<') {
      for (let depth = 1; i < definition.length && depth > 0; ) {
        i++;
        if (definition[i] === '<') depth++;
        else if (definition[i] === '>') depth--;
      }
      i++;
    }
    return { type: 'unknown', next: i, isFunction: true };
  }

  switch (char) {
    case 's':
      return { type: 'string', next: i };
    case 'n':
      return { type: 'number', next: i };
    case 'b':
      return { type: 'boolean', next: i };
    case 'o':
      return { type: 'object', next: i };
    // `l` is null, `u`/`j`/`x` are "some scalar" / "any JSON" / "anything".
    case 'l':
    case 'u':
    case 'j':
    case 'x':
      return { type: 'unknown', next: i };
    default:
      return null;
  }
}

/** Where the parameters end and the return type begins, or -1 for neither. */
function returnSeparator(body: string): number {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '<' || char === '(') depth++;
    else if (char === '>' || char === ')') depth--;
    else if (char === ':' && depth === 0) return i;
  }
  return -1;
}

/** Read a signature, or null when it cannot be read. */
export function parseSignature(definition: string): Signature | null {
  if (!definition.startsWith('<') || !definition.endsWith('>')) return null;
  const body = definition.slice(1, -1);
  const separator = returnSeparator(body);
  const paramText = separator === -1 ? body : body.slice(0, separator);
  const returnText = separator === -1 ? '' : body.slice(separator + 1);

  const params: SignatureParam[] = [];
  let at = 0;
  while (at < paramText.length) {
    const read = readType(paramText, at);
    if (read === null) return null;
    at = read.next;

    const param: SignatureParam = {
      type: read.type,
      optional: false,
      variadic: false,
      fromContext: false,
      isFunction: read.isFunction ?? false,
    };
    // Modifiers follow the type, in any order and any number.
    for (; at < paramText.length; at++) {
      if (paramText[at] === '?') param.optional = true;
      else if (paramText[at] === '+') param.variadic = true;
      else if (paramText[at] === '-') param.fromContext = true;
      else break;
    }
    params.push(param);
  }

  if (returnText === '') return { params, returns: 'unknown' };
  const returned = readType(returnText, 0);
  if (returned === null || returned.next !== returnText.length) return null;
  return { params, returns: returned.type };
}

/**
 * The parameter governing argument `index`, or undefined when the call has more arguments than the signature describes.
 */
export function paramAt(signature: Signature, index: number): SignatureParam | undefined {
  const exact = signature.params[index];
  if (exact) return exact;
  const last = signature.params[signature.params.length - 1];
  return last?.variadic ? last : undefined;
}
