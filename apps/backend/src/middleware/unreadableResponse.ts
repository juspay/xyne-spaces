import type { Request, Response, NextFunction } from 'express';
import { UnreadableString, reveal } from '@xyne/shared';

/** `value` with each `UnreadableString` replaced by the value it holds; plain objects and arrays are copied, nothing else is touched. */
function heldValues(value: unknown): unknown {
  if (value instanceof UnreadableString) return reveal(value);
  if (Array.isArray(value)) return value.map(heldValues);
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, heldValues(child)]));
  }
  return value;
}

/**
 * A contract route's response carries an `UnreadableString` as the value it holds, so the
 * caller gets the stored value back: storage ciphertext, which transformResponse (or the
 * global response encryption) turns into the caller's transit ciphertext, or plaintext when
 * encryption is off. Without it the value would serialize as "<redacted>". The REST
 * counterpart of Zero sync, which sends the row as stored; the handler never reads it.
 *
 * Mounted after transformResponse, so its res.json runs first and hands it the held values.
 */
export function unwrapUnreadableResponse(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body?: unknown): Response => json(heldValues(body))) as Response['json'];
  next();
}
