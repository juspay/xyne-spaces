import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import {
  CLIENT_MANIFEST_STALE_CODE,
  CLIENT_MANIFEST_TAG_HEADER,
  CLIENT_MANIFEST_VERSION_HEADER,
  findRequestRule,
  findRuleViolations,
} from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider, getLatestClientManifest } from '@/services/encryption';

function sanitizeForLog(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, '');
}

function hasEncryptedFields(obj: unknown): boolean {
  if (typeof obj === 'string') {
    return obj.startsWith('ENC:v1|sess|');
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasEncryptedFields(item)) return true;
    }
    return false;
  }

  if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      if (hasEncryptedFields(value)) return true;
    }
  }

  return false;
}

/**
 * Reject writes to manifest-listed routes whose `x-enc-manifest-version` is older than
 * the latest manifest (409 ENC_MANIFEST_STALE), so the client refreshes and retries.
 * Routes not in the manifest pass through.
 */
export async function enforceClientManifestVersion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const method = req.method?.toUpperCase();
  if (!config.enc.apiClientEncryptionEnabled || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const tagHeader = req.get(CLIENT_MANIFEST_TAG_HEADER);
  const tag = tagHeader ? tagHeader : 'default';

  let latest: Awaited<ReturnType<typeof getLatestClientManifest>>;
  try {
    latest = await getLatestClientManifest(tag);
  } catch (error) {
    // Fail open: a manifest lookup failure must not take every write down with it.
    logger.error('[decryptionMiddleware] failed to load client manifest, skipping version check', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
      tag: sanitizeForLog(tag),
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
    return next();
  }
  if (!latest) return next();

  if (!findRequestRule(latest, method, req.originalUrl)) {
    return next();
  }

  const versionHeader = req.get(CLIENT_MANIFEST_VERSION_HEADER);
  const version = versionHeader && /^\d+$/.test(versionHeader) ? Number(versionHeader) : NaN;
  // A version newer than ours means this backend's cache is behind; let it through.
  if (Number.isNaN(version) || version < latest.version) {
    res.status(409).json({
      error: 'Client encryption manifest is stale',
      code: CLIENT_MANIFEST_STALE_CODE,
      latestVersion: latest.version,
    });
    return;
  }

  next();
}

/**
 * Decrypt `ENC:v1|sess|…` fields with the caller's session key. The key is scoped to the
 * auth session (JWT `sid`), so this runs after authentication: the auth middlewares call
 * it in place of `next()` once `req.user` is set, rather than it being mounted globally.
 */
export async function decryptRequestBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // The manifest version check runs first; it either calls back here or has already
  // answered with 409.
  let manifestCurrent = false;
  await enforceClientManifestVersion(req, res, () => {
    manifestCurrent = true;
  });
  if (!manifestCurrent) return;

  await decryptRequestBody(req, next);
}

async function decryptRequestBody(req: Request, next: NextFunction): Promise<void> {
  try {
    const method = req.method?.toUpperCase();

    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      return next();
    }

    if (!hasEncryptedFields(req.body)) {
      return next();
    }

    const sessionId = req.user?.sid;

    if (!sessionId) {
      logger.warn('[decryptionMiddleware] encrypted fields present but session ID missing', {
        method: sanitizeForLog(method),
        path: sanitizeForLog(req.path),
        hasSessionId: Boolean(sessionId),
      });
      getCryptoOperations().add(1, {
        operation: 'decrypt_request_body',
        status: 'error',
        reason: !sessionId ? 'missing_session' : 'missing_user',
        path: req.path,
      });
      return next(new AppError('Encrypted request body requires an active session', 400));
    }

    logger.info('[decryptionMiddleware] encrypted fields detected in request body', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
    });

    req.body = await getEncryptionProvider().decryptRequest(req.body, sessionId);

    logger.info('[decryptionMiddleware] request body decrypted successfully', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
    });
  } catch (error) {
    logger.error('[decryptionMiddleware] failed to decrypt request body', {
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
    getCryptoOperations().add(1, {
      operation: 'decrypt_request_body',
      status: 'error',
      reason: 'decrypt_failed',
      path: sanitizeForLog(req.path),
    });
    return next(new AppError('Failed to decrypt encrypted request body', 502));
  }
  next();
}

/**
 * Per-route counterpart of decryptRequestBodyMiddleware for multipart routes listed in
 * the client manifest. Mount it after the upload middleware: express.json() skips
 * multipart, so `req.body` is still undefined when the auth middleware runs and is only
 * filled in by multer. Rejects bodies that violate the manifest rule (400
 * ENC_MANIFEST_VIOLATION), then decrypts session-key fields so the controller sees
 * plaintext. The manifest version check already ran in the auth middleware.
 */
export async function decryptManifestRequestBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.enc.apiClientEncryptionEnabled) {
    return next();
  }

  const tagHeader = req.get(CLIENT_MANIFEST_TAG_HEADER);
  const tag = tagHeader ? tagHeader : 'default';

  let latest: Awaited<ReturnType<typeof getLatestClientManifest>> = null;
  try {
    latest = await getLatestClientManifest(tag);
  } catch (error) {
    // Fail open on the rule check, as enforceClientManifestVersion does; decryption below
    // still runs.
    logger.error('[decryptionMiddleware] failed to load client manifest, skipping rule check', {
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
      tag: sanitizeForLog(tag),
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
  }

  const rule = latest ? findRequestRule(latest, req.method, req.originalUrl) : undefined;
  if (rule) {
    const violations = findRuleViolations(req.body, rule);
    if (violations.length > 0) {
      res.status(400).json({
        error: 'Request violates the client encryption manifest',
        code: 'ENC_MANIFEST_VIOLATION',
        violations,
      });
      return;
    }
  }

  await decryptRequestBody(req, next);
}

/**
 * Encrypt JSON responses for the caller's session key. Mounted globally: `res.json` runs
 * after the route's auth middleware, so `req.user.sid` is already resolved by then.
 */
export function encryptResponseBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown): Response => {
    const sessionId = req.user?.sid;
    if (!sessionId || !body || typeof body !== 'object') {
      return originalJson(body);
    }

    void getEncryptionProvider().encryptResponse(body, sessionId)
      .then((encryptedBody) => originalJson(encryptedBody))
      .catch((error) => {
        logger.error('[decryptionMiddleware] failed to encrypt response body', {
          method: sanitizeForLog(req.method),
          path: sanitizeForLog(req.path),
          error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
        });
        if (!res.headersSent) {
          res.status(502);
          originalJson({ error: 'Failed to encrypt response body' });
        } else {
          res.end();
        }
      });

    return res;
  }) as Response['json'];

  next();
}
