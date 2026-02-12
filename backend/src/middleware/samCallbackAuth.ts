/**
 * SAM Callback Authentication Middleware
 * Verifies API key for callbacks from SAM service (Google Meet processing)
 */

import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export function verifySamCallback(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // Check if SAM_API_KEY is configured - require it always
  if (!config.sam.apiKey) {
    logger.error('[SAM Auth] SAM_API_KEY not configured on server');
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  if (!apiKey) {
    logger.warn('[SAM Auth] Missing x-api-key header in SAM callback', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.sam.apiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  // IMPORTANT: length check before timingSafeEqual to prevent timing attacks
  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('[SAM Auth] Invalid API key in SAM callback', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  logger.debug('[SAM Auth] SAM callback authenticated successfully');
  next();
}
