import type { NextFunction, Request, Response } from 'express';
import { UnreadableString, reveal } from '@xyne/shared';

/** Whether `value` is a plain object or array to look inside (Prisma rows are plain-prototype proxies). */
function isContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `value` with every `UnreadableString` replaced by the value it holds; anything else is kept
 * as it is (a container is copied only when something inside it changed). Only for a body on
 * its way to the client that the value belongs to: plaintext with DB encryption off,
 * workspace-DEK ciphertext with it on (the response encryption then re-encrypts it for the caller).
 */
export function revealUnreadable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof UnreadableString) return reveal(value);
  if (!value || typeof value !== 'object' || !isContainer(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    let next: unknown[] | undefined;
    value.forEach((item, index) => {
      const revealed = revealUnreadable(item, seen);
      if (revealed !== item) {
        next ??= [...value];
        next[index] = revealed;
      }
    });
    return next ?? value;
  }
  let next: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(value)) {
    const revealed = revealUnreadable(item, seen);
    if (revealed !== item) {
      next ??= { ...value };
      next[key] = revealed;
    }
  }
  return next ?? value;
}

/**
 * Reveals the `UnreadableString`s in a JSON response body (rows read through `unreadableDb`)
 * before it is sent, so the client gets the stored value instead of their "<redacted>" toJSON.
 * It must run before the response encryption steps (encryptResponseBodyMiddleware, and
 * encryptedRoute's transformResponse), which serialize the body: Express calls the res.json
 * installed last first, so this is installed after each of them.
 */
export function revealUnreadableResponse(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown): Response => originalJson(revealUnreadable(body))) as Response['json'];
  next();
}
