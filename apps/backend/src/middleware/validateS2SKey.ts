import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';

function keysMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // timingSafeEqual throws on unequal lengths, so check length first.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Service-to-service key validation middleware.
 * Checks the x-s2s-key header against INTERNAL_S2S_KEY env var.
 * Used to protect endpoints that should only be callable by internal
 * services (e.g. xyne-claw MCP tools).
 */
export const validateS2SKey = (req: Request, res: Response, next: NextFunction): void => {
  const s2sKey = config.internalS2sKey;
  const provided = req.headers['x-s2s-key'];
  if (!s2sKey || typeof provided !== 'string' || !keysMatch(s2sKey, provided)) {
    res.status(401).json({ error: 'Invalid or missing S2S key' });
    return;
  }
  next();
};