import type { NextFunction, Request, Response } from 'express';
import { revealUnreadable } from '@/utils/revealUnreadable';

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
