import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import { getEncryptionProvider } from '@/services/encryption';

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

export async function decryptRequestBodyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const method = req.method?.toUpperCase();

    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      return next();
    }

    if (!hasEncryptedFields(req.body)) {
      return next();
    }

    const sessionId = req.cookies?.user_session_id ?? (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      logger.warn('[decryptionMiddleware] encrypted fields present but session ID missing', {
        method,
        path: req.path,
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
      method,
      path: req.path,
    });

    req.body = await getEncryptionProvider().decryptRequest(req.body, sessionId);

    logger.info('[decryptionMiddleware] request body decrypted successfully', {
      method,
      path: req.path,
    });
  } catch (error) {
    logger.error('[decryptionMiddleware] failed to decrypt request body', {
      method: req.method,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    getCryptoOperations().add(1, {
      operation: 'decrypt_request_body',
      status: 'error',
      reason: 'decrypt_failed',
      path: req.path,
    });
    return next(new AppError('Failed to decrypt encrypted request body', 502));
  }
  next();
}

export function encryptResponseBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown): Response => {
    const sessionId = req.cookies?.user_session_id ?? (req.headers['x-session-id'] as string | undefined);
    if (!sessionId || !body || typeof body !== 'object') {
      return originalJson(body);
    }

    void getEncryptionProvider().encryptResponse(body, sessionId)
      .then((encryptedBody) => originalJson(encryptedBody))
      .catch((error) => {
        logger.error('[decryptionMiddleware] failed to encrypt response body', {
          method: req.method,
          path: req.path,
          error: error instanceof Error ? error.message : String(error),
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
