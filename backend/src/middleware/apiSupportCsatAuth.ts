import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/** Shared-secret auth for external systems posting CSAT results for tickets they own (e.g. API-support desks). */
export function verifyApiSupportCsatRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!config.apiSupportCsatApiKey) {
    logger.error('API_SUPPORT_CSAT_API_KEY not configured on server');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.apiSupportCsatApiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('Invalid API key in external CSAT request', { path: req.path, method: req.method });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
