import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import {
  CLIENT_MANIFEST_ENVIRONMENT_HEADER,
  CLIENT_MANIFEST_STALE_CODE,
  CLIENT_MANIFEST_TAG_HEADER,
  CLIENT_MANIFEST_VERSION_HEADER,
  findRequestRule,
  findRuleViolations,
} from '@xyne/shared';
import { config } from '@/config/env';
import {
  getEncryptionProvider,
  getLatestClientManifest,
  isDekPassthrough,
  manifestEnvironmentForRequest,
} from '@/services/encryption';
import type { ClientEncryptionManifest, ClientManifestEnvironment, ClientManifestRule } from '@/services/encryption';
import { TRANSIT_TICKET_COOKIE, TRANSIT_TICKET_HEADER } from '@/services/encryption/types';

export function sanitizeForLog(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, '');
}

function hasEncryptedFields(obj: unknown): boolean {
  if (typeof obj === 'string') {
    return obj.startsWith('ENC:v1|tk-');
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

/** Same environment and a version not older than the latest; no version = not current. */
function isClientManifestCurrent(
  req: Request,
  latest: ClientEncryptionManifest,
  environment: ClientManifestEnvironment,
): boolean {
  const clientEnvironment = req.get(CLIENT_MANIFEST_ENVIRONMENT_HEADER);
  if (clientEnvironment && clientEnvironment !== environment) return false;
  const versionHeader = req.get(CLIENT_MANIFEST_VERSION_HEADER);
  const version = versionHeader && /^\d+$/.test(versionHeader) ? Number(versionHeader) : NaN;
  // Newer than ours: our cache is behind.
  return !Number.isNaN(version) && version >= latest.version;
}

function sendStale(
  res: Response,
  latest: ClientEncryptionManifest,
  environment: ClientManifestEnvironment,
): void {
  res.status(409).json({
    error: 'Client encryption manifest is stale',
    code: CLIENT_MANIFEST_STALE_CODE,
    latestVersion: latest.version,
    environment,
  });
}

/** Body breaks the latest rule: 409 if the client's manifest is old (it retries), else 400. */
export function rejectIfRuleViolated(
  req: Request,
  res: Response,
  rule: ClientManifestRule,
  latest: ClientEncryptionManifest,
  environment: ClientManifestEnvironment,
): boolean {
  const violations = findRuleViolations(req.body, rule);
  if (violations.length === 0) return false;
  if (!isClientManifestCurrent(req, latest, environment)) {
    sendStale(res, latest, environment);
    return true;
  }
  res.status(400).json({
    error: 'Request violates the client encryption manifest',
    code: 'ENC_MANIFEST_VIOLATION',
    violations,
  });
  return true;
}

/**
 * Manifest-listed writes: 409 if encrypted with another environment's manifest; otherwise
 * the body is checked against the latest rule (multipart later, after multer).
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
  const environment = manifestEnvironmentForRequest(req);

  let latest: Awaited<ReturnType<typeof getLatestClientManifest>>;
  try {
    latest = await getLatestClientManifest(tag, environment);
  } catch (error) {
    // Fail open: a manifest lookup failure must not take every write down with it.
    logger.error('[decryptionMiddleware] failed to load client manifest, skipping version check', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
      tag: sanitizeForLog(tag),
      environment,
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
    return next();
  }
  if (!latest) return next();

  const rule = findRequestRule(latest, method, req.originalUrl);
  if (!rule) {
    return next();
  }

  const clientEnvironment = req.get(CLIENT_MANIFEST_ENVIRONMENT_HEADER);
  if (clientEnvironment && clientEnvironment !== environment) {
    sendStale(res, latest, environment);
    return;
  }

  // Multipart is not parsed yet here.
  if (req.body && typeof req.body === 'object' && !req.is('multipart/form-data')) {
    if (rejectIfRuleViolated(req, res, rule, latest, environment)) return;
  }

  next();
}

/**
 * Decrypt `ENC:v1|tk-<ticket>|…` fields. Each ticket seals its own key and is bound to the
 * auth session (JWT `sid`), so this runs after authentication: the auth middlewares call it in
 * place of `next()` once `req.user` is set, rather than it being mounted globally.
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

export async function decryptRequestBody(req: Request, next: NextFunction): Promise<void> {
  try {
    const method = req.method?.toUpperCase();

    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      return next();
    }

    if (!hasEncryptedFields(req.body)) {
      return next();
    }

    const subject = req.user?.sid;

    if (!subject) {
      logger.warn('[decryptionMiddleware] encrypted fields present but session ID missing', {
        method: sanitizeForLog(method),
        path: sanitizeForLog(req.path),
        hasSessionId: false,
      });
      getCryptoOperations().add(1, {
        operation: 'decrypt_request_body',
        status: 'error',
        reason: 'missing_session',
        path: req.path,
      });
      return next(new AppError('Encrypted request body requires an active session', 400));
    }

    logger.info('[decryptionMiddleware] encrypted fields detected in request body', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
    });

    req.body = await getEncryptionProvider().decryptRequest(req.body, subject);

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

export function transitTicket(req: Request): string | undefined {
  const header = req.header(TRANSIT_TICKET_HEADER);
  if (header) return header;
  const cookie: unknown = req.cookies?.[TRANSIT_TICKET_COOKIE];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined;
}

/**
 * Encrypt JSON responses under the caller's current transit ticket. Mounted globally:
 * `res.json` runs after the route's auth middleware, so `req.user.sid` is already resolved.
 * Routes mounted with encryptedRoute re-encrypt their own response from the DEK; under DEK
 * passthrough this passes that body through.
 */
export function encryptResponseBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown): Response => {
    const subject = req.user?.sid;
    if (!subject || !body || typeof body !== 'object' || isDekPassthrough()) {
      return originalJson(body);
    }

    void getEncryptionProvider()
      .encryptResponse(body, subject, transitTicket(req))
      .then((result) => originalJson(result.body))
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
