import type { NextFunction, Request, Response } from 'express';
import { FILE_ENCRYPTION_HEADER, FILE_ENCRYPTION_HEADER_VALUE, isClientEncryptedFileRoute } from '@xyne/shared';
import { config } from '@/config/env';
import { currentRequest } from '@/database/tenant/context';
import type { TransitCaller } from '@/services/encryption';
import { transitCaller } from './decryptionMiddleware';

const CLIENT_FILE_ENCRYPTION = Symbol('clientFileEncryption');
/** The ingress transit proxy's identity header (`TRANSIT_PROXY_HEADER` in apps/middelware/authenticator.ts). */
const TRANSIT_PROXY_HEADER = 'x-xyne-transit-proxy';
/** 400 code for an encrypted upload while file encryption is off (the transit proxy retries plain). */
const FILE_ENCRYPTION_DISABLED_CODE = 'FILE_ENCRYPTION_DISABLED';

/**
 * Routes whose uploads are stored unencrypted: workspace-wide images the browser loads by
 * address (`<img src>`), where nothing could add the file encryption header or decrypt.
 * Their reads need nothing: an object without `enc-v` is read as plaintext.
 */
const UNENCRYPTED_FILE_WRITES: ReadonlyArray<{ method: string; path: RegExp }> = [
  // Custom emojis: shown by address in messages, reactions, statuses and the editor.
  { method: 'POST', path: /^(?:\/api)?\/emojis\/?$/ },
  // Call background presets: loaded by address into the picker and the call's video effect.
  { method: 'POST', path: /^(?:\/api)?\/calls\/admin\/backgrounds\/?$/ },
];

/**
 * Mounted once, before the routes. On a route of @xyne/shared's CLIENT_ENCRYPTED_FILE_ROUTES
 * (the list the dashboard encrypts and decrypts by) whose request carries
 * `x-file-encryption: XEF1`, uploads are the client's transit containers (re-encrypted under
 * the workspace storage key by the encryption service) and encrypted downloads go back as
 * transit containers for the client to decrypt. Requests without the header (mobile, Electron)
 * and every other route keep sending and receiving plaintext.
 */
export function clientFileEncryption(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl.split('?')[0] ?? '';
  if (!isClientEncryptedFileRoute(req.method, path)) {
    next();
    return;
  }
  // The same URL answers with plaintext or a transit container depending on the header.
  res.vary(FILE_ENCRYPTION_HEADER);
  // Bot traffic (/api/apps) is encrypted by the ingress transit proxy, which sets the header
  // only with its own identity header; without that the header did not come from the proxy.
  const appsWithoutProxy = path.startsWith('/api/apps/') && !req.headers[TRANSIT_PROXY_HEADER];
  if (req.headers[FILE_ENCRYPTION_HEADER] !== FILE_ENCRYPTION_HEADER_VALUE || appsWithoutProxy) {
    next();
    return;
  }
  if (!config.enc.enableStorageEncryption && !config.enc.enableStorageDecryption) {
    // Nothing is stored encrypted: a download is served as is. An upload's container could
    // not be stored readable, so it is refused with a code the transit proxy answers by
    // resending the files plain (the dashboard does not encrypt while this is off).
    if (req.method === 'GET') {
      next();
      return;
    }
    res.status(400).json({ error: 'Bad request', message: 'File encryption is not enabled', code: FILE_ENCRYPTION_DISABLED_CODE });
    return;
  }
  (req as unknown as Record<symbol, boolean>)[CLIENT_FILE_ENCRYPTION] = true;
  next();
}

/** Whether `req` came through clientFileEncryption with the header set. */
export function isClientFileEncryption(req: Request): boolean {
  return (req as unknown as Record<symbol, boolean>)[CLIENT_FILE_ENCRYPTION] === true;
}

/** Whether the current request's uploads are stored unencrypted (UNENCRYPTED_FILE_WRITES). */
export function isUnencryptedFileWrite(): boolean {
  const req = currentRequest();
  if (!req) return false;
  const path = req.originalUrl.split('?')[0] ?? '';
  return UNENCRYPTED_FILE_WRITES.some(r => r.method === req.method && r.path.test(path));
}

/**
 * The transit caller of the current request when its files travel as transit containers;
 * `null` outside such a request (other routes, jobs, workers).
 */
export function clientFileCaller(): TransitCaller | null {
  const req = currentRequest();
  return req && isClientFileEncryption(req) ? transitCaller(req) : null;
}
