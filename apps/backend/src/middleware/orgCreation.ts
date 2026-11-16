import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';

/**
 * Blocks organization creation unless ENABLE_ORG_CREATION=true (off when unset).
 */
export const requireOrgCreationEnabled = (_req: Request, res: Response, next: NextFunction): void => {
  if (!config.enableOrgCreation) {
    res.status(403).json({ error: 'Organization creation is disabled' });
    return;
  }
  next();
};
