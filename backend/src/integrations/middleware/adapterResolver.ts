import { Request, Response, NextFunction } from 'express';
import { ExternalSourceAdapter } from '../core/types';
import { adapterRegistry } from '../core/adapterRegistry';
import { logger } from '../../utils/logger';

// Extend Express Request to include adapter
declare module 'express-serve-static-core' {
  interface Request {
    adapter?: ExternalSourceAdapter;
  }
}

/**
 * Middleware to resolve adapter from sourceName
 * Attaches adapter to req.adapter
 *
 * Usage:
 *   router.post('/:sourceName/ingest', adapterResolver, handler)
 */
export function adapterResolver(
  req: Request,
  res: Response,
  next: NextFunction
): void | Response {
  try {
    const { sourceName } = req.params;

    if (!sourceName) {
      res.status(400).json({
        error: 'sourceName is required'
      });
      return;
    }

    // Resolve adapter from registry
    const adapter = adapterRegistry.getAdapter(sourceName);

    // Attach to request
    req.adapter = adapter;
    req.sourceName = sourceName;

    logger.debug(`Resolved ${adapter.name} adapter for ${sourceName}`);
    next();

  } catch (error) {
    logger.error('Adapter resolution error:', error);
    res.status(404).json({
      error: 'Adapter not found',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
}
