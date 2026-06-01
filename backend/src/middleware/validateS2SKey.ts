import { Request, Response, NextFunction } from 'express';

/**
 * Service-to-service key validation middleware.
 * Checks the x-s2s-key header against INTERNAL_S2S_KEY env var.
 * Used to protect endpoints that should only be callable by internal
 * services (e.g. xyne-claw MCP tools).
 */
export const validateS2SKey = (req: Request, res: Response, next: NextFunction): void => {
  const s2sKey = process.env['INTERNAL_S2S_KEY'];
  if (!s2sKey || req.headers['x-s2s-key'] !== s2sKey) {
    res.status(401).json({ error: 'Invalid or missing S2S key' });
    return;
  }
  next();
};