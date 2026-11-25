import type { NextFunction, Request, Response } from 'express';
import { FILE_ENCRYPTION_HEADER, FILE_ENCRYPTION_HEADER_VALUE } from '@xyne/shared';
import { config } from '@/config/env';
import { currentRequest } from '@/database/tenant/context';
import type { TransitCaller } from '@/services/encryption';
import { transitCaller } from './decryptionMiddleware';

const CLIENT_FILE_ENCRYPTION = Symbol('clientFileEncryption');

/**
 * Mount on a route whose files the client encrypts itself: when the request carries
 * `x-file-encryption: XEF1`, its uploads are the client's transit containers (re-encrypted
 * under the workspace storage key by the encryption service) and its encrypted downloads come
 * back as transit containers for the client to decrypt. Requests without the header (mobile,
 * Electron) keep sending and receiving plaintext.
 */
export function clientFileEncryption(req: Request, res: Response, next: NextFunction): void {
  if (req.headers[FILE_ENCRYPTION_HEADER] !== FILE_ENCRYPTION_HEADER_VALUE) {
    next();
    return;
  }
  if (!config.enc.enableStorageEncryption && !config.enc.enableStorageDecryption) {
    res.status(400).json({ error: 'Bad request', message: 'File encryption is not enabled' });
    return;
  }
  (req as unknown as Record<symbol, boolean>)[CLIENT_FILE_ENCRYPTION] = true;
  next();
}

/** Whether `req` came through clientFileEncryption with the header set. */
export function isClientFileEncryption(req: Request): boolean {
  return (req as unknown as Record<symbol, boolean>)[CLIENT_FILE_ENCRYPTION] === true;
}

/**
 * The transit caller of the current request when its files travel as transit containers;
 * `null` outside such a request (other routes, jobs, workers).
 */
export function clientFileCaller(): TransitCaller | null {
  const req = currentRequest();
  return req && isClientFileEncryption(req) ? transitCaller(req) : null;
}
