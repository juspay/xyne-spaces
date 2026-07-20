import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Middleware to authenticate internal service-to-service requests.
 * Validates X-Internal-Service-Secret header against INTERNAL_SERVICE_SECRET env var.
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent timing attacks.
 */
export const internalServiceAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const expectedSecret = process.env.INTERNAL_SERVICE_SECRET;
  const providedSecret = req.headers['x-internal-service-secret'] as string | undefined;

  if (!expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!providedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const expectedBuf = Buffer.from(expectedSecret, 'utf8');
    const providedBuf = Buffer.from(providedSecret, 'utf8');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  } catch (error) {
    // Usually a malformed header or a misconfigured secret — without this log
    // that is indistinguishable from an auth attack.
    logger.error('internal_service_auth_failed', { error });
    res.status(401).json({ error: 'Unauthorized' });
  }
};
