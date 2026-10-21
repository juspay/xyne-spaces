import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../re-exports';
import { GatewayError } from '../errors';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Express 4 does not pass a rejected promise to error middleware, so every gateway handler goes through this. */
export function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function gatewayErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: error.errors });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' });
    return;
  }

  if (error instanceof GatewayError) {
    if (error.statusCode >= 500) {
      logger.error('[Gateway] Request failed', {
        path: req.path,
        code: error.code,
        error: error.message,
      });
    }
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }

  logger.error('[Gateway] Unhandled error', { path: req.path, error });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}
