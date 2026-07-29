import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

function extractApiKey(req: Request): string | undefined {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') {
    return undefined;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token) {
    return undefined;
  }

  const normalizedScheme = scheme.toLowerCase();
  if (normalizedScheme !== 'bearer' && normalizedScheme !== 'basic') {
    return undefined;
  }

  return token.trim();
}

export function verifyMettleUserSyncAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.mettleUserSyncApiKey) {
    logger.error('[Mettle User Sync Auth] METTLE_USER_SYNC_API_KEY not configured on server');
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    logger.warn('[Mettle User Sync Auth] Missing API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.mettleUserSyncApiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('[Mettle User Sync Auth] Invalid API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
