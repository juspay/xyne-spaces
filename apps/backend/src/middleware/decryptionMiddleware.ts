import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import { getEncryptionProvider, isDekPassthrough } from '@/services/encryption';
import { TRANSIT_KEY_COOKIE, type TransitCaller } from '@/services/encryption/types';

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

/**
 * Decrypt `ENC:v1|tk-<version>|…` fields with the keys derived for the caller's transit
 * public key (header or `xk` cookie). Runs after authentication: the auth middlewares call
 * it in place of `next()` once `req.user` is set, rather than it being mounted globally.
 */
export async function decryptRequestBodyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  await decryptRequestBody(req, next);
}

/**
 * Zero pushes, which this middleware leaves alone: a mutator with a manifest rule is transformed
 * by the encryption service before it runs, and one without a rule takes plaintext args
 * (zero/encryptedMutation.ts prepareEncryptedMutations refuses transit ciphertext in them).
 */
const ZERO_PUSH_PATHS = new Set(['/api/zero/push', '/api/zero/push-fallback']);

function isZeroPush(req: Request): boolean {
  return ZERO_PUSH_PATHS.has((req.originalUrl ?? '').split('?')[0]);
}

export async function decryptRequestBody(req: Request, next: NextFunction): Promise<void> {
  try {
    const method = req.method?.toUpperCase();

    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      return next();
    }

    if (isZeroPush(req) || !hasEncryptedFields(req.body)) {
      return next();
    }

    const caller = transitCaller(req);

    if (!hasTransitCaller(caller)) {
      logger.warn('[decryptionMiddleware] encrypted fields present but client transit key missing', {
        method: sanitizeForLog(method),
        path: sanitizeForLog(req.path),
      });
      getCryptoOperations().add(1, {
        operation: 'decrypt_request_body',
        status: 'error',
        reason: 'missing_client_key',
        path: req.path,
      });
      return next(new AppError('Encrypted request body requires the client transit key', 400));
    }

    logger.info('[decryptionMiddleware] encrypted fields detected in request body', {
      method: sanitizeForLog(method),
      path: sanitizeForLog(req.path),
    });

    req.body = await getEncryptionProvider().decryptRequest(req.body, caller);

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
 * Whom the request's transit operations are for. The encryption service reads the `sid` of the
 * forwarded access token and uses the transit key the client registered for that session
 * (`POST /api/transit/register`); the backend never holds it. The `xk` cookie the register
 * route set goes along for a session the service has no key for.
 */
export function transitCaller(req: Request): TransitCaller {
  // Proxy traffic names only the proxy: never a session token or a key of its own.
  if (req.proxyClient) {
    return { proxyClient: req.proxyClient };
  }
  const cookie: unknown = req.cookies?.[TRANSIT_KEY_COOKIE];
  const clientKey = typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined;
  return {
    ...(req.authToken ? { authToken: req.authToken } : {}),
    ...(clientKey ? { clientKey } : {}),
  };
}

/** Whether the request names a transit key at all (an access token or a key of its own). */
export function hasTransitCaller(caller: TransitCaller): boolean {
  return Boolean(caller.proxyClient || caller.authToken || caller.clientKey);
}

/**
 * Encrypt JSON responses for the caller's transit public key. Mounted globally: `res.json`
 * runs after the route's auth middleware, so `req.user` is already resolved. The encryption
 * service decides whether the body has fields to encrypt; when it has and the caller
 * presented no key, the response is `400 TRANSIT_KEY_REQUIRED` rather than plaintext.
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
    if (!req.user?.sid || !body || typeof body !== 'object' || isDekPassthrough()) {
      return originalJson(body);
    }

    void getEncryptionProvider()
      .encryptResponse(body, transitCaller(req))
      .then((result) => originalJson(result.body))
      .catch((error) => {
        // The service's own verdict (no client key for a body that needs encrypting) goes
        // to the client as sent, with its code.
        const { status, body: verdict } = error as { status?: unknown; body?: unknown };
        if (status === 400 && typeof (verdict as { code?: unknown } | undefined)?.code === 'string' && !res.headersSent) {
          res.status(400);
          originalJson(verdict);
          return;
        }
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
