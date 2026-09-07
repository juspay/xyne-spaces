import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Authenticates calls to y-sweet-only backend routes (e.g. /api/ysweet/validate)
 * via a shared secret sent as `Authorization: Bearer <token>`. These routes
 * have no user session to check — the caller is the y-sweet server, not a
 * browser — so a bearer secret configured on both sides is how we confirm
 * the request actually came from y-sweet and not an arbitrary caller.
 */
export const requireYSweetServerToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const expectedToken = config.ysweet.serverToken;
  const authHeader = req.headers.authorization;
  const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!expectedToken || !providedToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const expectedBuf = Buffer.from(expectedToken, 'utf8');
    const providedBuf = Buffer.from(providedToken, 'utf8');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  } catch (error) {
    logger.error('ysweet_server_auth_failed', { error });
    res.status(401).json({ error: 'Unauthorized' });
  }
};
