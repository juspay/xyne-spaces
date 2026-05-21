import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

function extractApiKey(req: Request): string | undefined {
  const headerValue = req.headers['x-s2s-key'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }

  return undefined;
}

export function verifyTeamIntelligenceSyncAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.teamIntelligenceSyncApiKey) {
    logger.error('[TeamIntelligenceAuth] TEAM_INTELLIGENCE_SYNC_API_KEY not configured on server');
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    logger.warn('[TeamIntelligenceAuth] Missing API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.teamIntelligenceSyncApiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('[TeamIntelligenceAuth] Invalid API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
