import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

function keysMatch(suppliedKey: string, configuredKey: string): boolean {
  const supplied = Buffer.from(suppliedKey, 'utf8');
  const configured = Buffer.from(configuredKey, 'utf8');
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function authorizeTranscriptionSwitch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.user?.id;
  const suppliedKey = req.get('x-api-key');
  const { apiKey, allowedUserIds } = config.transcriptionSwitch;

  if (!apiKey || allowedUserIds.length === 0) {
    logger.error('[TranscriptionSwitch] Server authorization is not configured');
    res.status(503).json({ success: false, error: 'Transcription switching is not configured' });
    return;
  }

  if (!userId || !allowedUserIds.includes(userId)) {
    logger.warn('[TranscriptionSwitch] Request denied for non-allowlisted user', { userId });
    res.status(403).json({ success: false, error: 'Transcription switching is not authorized' });
    return;
  }

  if (!suppliedKey || !keysMatch(suppliedKey, apiKey)) {
    logger.warn('[TranscriptionSwitch] Request denied due to invalid API key', { userId });
    res.status(403).json({ success: false, error: 'Transcription switching is not authorized' });
    return;
  }

  next();
}
