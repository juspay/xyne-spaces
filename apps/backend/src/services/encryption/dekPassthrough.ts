import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';

const dekPassthroughContext = new AsyncLocalStorage<boolean>();

export function runWithDekPassthrough<T>(fn: () => T): T {
  return dekPassthroughContext.run(true, fn);
}

export function isDekPassthrough(): boolean {
  return dekPassthroughContext.getStore() ?? false;
}

/**
 * Within this request the Prisma extension leaves storage ciphertext (`ENC:v1|<dekId>|…`)
 * in results instead of decrypting it, and the response middleware hands the body to the
 * encryption service for DEK→CEK, so plaintext never exists in the backend. `next()` runs
 * the rest of the chain inside the store, so the route's async continuations (multer
 * keeps its caller's async scope) all see it, as with `loggerContext.run` in auth.
 */
export function dekPassthroughMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (config.enc.enableDbEncryption && config.enc.apiClientEncryptionEnabled && req.user?.sid) {
    runWithDekPassthrough(() => next());
    return;
  }
  next();
}
