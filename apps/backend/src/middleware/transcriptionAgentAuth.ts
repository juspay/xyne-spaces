import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export function verifyTranscriptionAgent(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!config.transcriptionAgentApiKey) {
    logger.error('TRANSCRIPTION_AGENT_API_KEY not configured on server');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  if (!apiKey) {
    logger.warn('Missing x-api-key header in transcription agent request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const serverKeyBuf = Buffer.from(config.transcriptionAgentApiKey, 'utf8');
  const clientKeyBuf = Buffer.from(apiKey, 'utf8');

  // IMPORTANT: length check before timingSafeEqual
  if (
    serverKeyBuf.length !== clientKeyBuf.length ||
    !timingSafeEqual(serverKeyBuf, clientKeyBuf)
  ) {
    logger.warn('Invalid API key in transcription agent request', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  logger.debug('Transcription agent authenticated successfully');
  next();
}
