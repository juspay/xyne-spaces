import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { CacConfigService } from '@/services/cacConfigService';
import { logger } from '@/utils/logger';
import { extractS2SApiKey } from './utils';

const TELEPRESENCE_CAC_KEY = 'xyne_telepresence_config';

interface TelepresenceCacConfig {
  enabled: boolean;
  allowedEmails: string[];
}

export async function requireTelepresenceMonitoringCacAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const email = req.user?.email;

  if (!email) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const cacConfig = await CacConfigService.fetch(TELEPRESENCE_CAC_KEY, { email }) as TelepresenceCacConfig | null;

  const normalizedEmail = email.toLowerCase();
  const isAllowed =
    !!cacConfig &&
    cacConfig.enabled &&
    cacConfig.allowedEmails.some((allowedEmail) => allowedEmail.toLowerCase() === normalizedEmail);

  if (!isAllowed) {
    logger.warn('[TelepresenceMonitoringAuth] User not allowed by telepresence CAC config', {
      email,
      path: req.path,
      method: req.method,
    });
    res.status(403).json({ error: 'Access to telepresence monitoring is not enabled for this user' });
    return;
  }

  next();
}

export function verifyTelepresenceMonitoringSyncAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.telepresenceMonitoringApiKey) {
    logger.error('[TelepresenceMonitoringAuth] TELEPRESENCE_MONITORING_API_KEY not configured on server');
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  const apiKey = extractS2SApiKey(req);
  if (!apiKey) {
    logger.warn('[TelepresenceMonitoringAuth] Missing API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.telepresenceMonitoringApiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('[TelepresenceMonitoringAuth] Invalid API key in request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
