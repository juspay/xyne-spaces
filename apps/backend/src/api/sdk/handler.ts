/**
 * Request plumbing for /api/sdk: correlation and the single error envelope.
 *
 * Every response leaving this API — success or failure — passes through here, so
 * the shape a caller sees is decided in one file rather than at each endpoint.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { REQUEST_ID_HEADER, type ApiErrorBody } from '@xyne/spaces-contract';
import { logger } from '@/utils/logger';
import { ApiError, toApiError } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id echoed on every response and embedded in error envelopes. */
      apiRequestId?: string;
    }
  }
}

/**
 * Accept a caller-supplied request id (so a client can correlate across a retry
 * chain) or mint one. Echoed on success and failure alike.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_ID_HEADER);
  const id = inbound && inbound.length <= 200 ? inbound : `req_${randomUUID()}`;
  req.apiRequestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/**
 * Wrap an async endpoint so a rejected promise reaches `errorHandler` instead of
 * becoming an unhandled rejection, and so schema failures arrive as validation
 * errors rather than as a generic 500.
 */
export function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch((err: unknown) => {
      next(err instanceof ZodError ? ApiError.validation(err) : err);
    });
  };
}

/** 404 for unmatched paths, in the SDK envelope rather than the app's. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError('not_found', `No such endpoint: ${req.method} ${req.path}`));
}

/**
 * Terminal error mapper — the only place a status code is written.
 *
 * Every failure carries a real status and a stable `code`. 5xx messages are
 * replaced with a generic string so database and SQL detail never reaches a
 * caller; the underlying cause is logged against the request id instead.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const apiError = err instanceof ApiError ? err : toApiError(err);
  const id = req.apiRequestId ?? 'unknown';
  const isServerError = apiError.status >= 500;

  const logPayload = {
    requestId: id,
    code: apiError.code,
    status: apiError.status,
    method: req.method,
    path: req.originalUrl,
    userId: req.sdkAuth?.authData.sub,
    keyId: req.sdkAuth?.keyId,
    err: apiError.cause ?? apiError,
  };
  if (isServerError) logger.error('[sdk] request failed', logPayload);
  else logger.warn('[sdk] request rejected', logPayload);

  if (apiError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(apiError.retryAfterSeconds));
  }

  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: isServerError ? 'An unexpected error occurred.' : apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      request_id: id,
      retryable: apiError.retryable,
      ...(apiError.retryAfterSeconds !== undefined
        ? { retry_after_seconds: apiError.retryAfterSeconds }
        : {}),
    },
  };

  res.status(apiError.status).json(body);
}
