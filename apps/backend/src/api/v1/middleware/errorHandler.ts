import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@xyne/spaces-contract';
import { logger } from '@/utils/logger';
import { ApiError, toApiError } from '../errors';

/**
 * Terminal error mapper for /api/v1 — the only place a status code is written.
 *
 * Unlike the legacy `/api/zero/*-fallback` handlers, which return HTTP 200 with
 * `{success:false}`, every failure here carries a real status code and a stable
 * `code`. 5xx messages are replaced with a generic string so database/SQL detail
 * never reaches a caller; the underlying cause is logged with the request id.
 */
export function v1ErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const apiError = err instanceof ApiError ? err : toApiError(err);
  const requestId = req.apiRequestId ?? 'unknown';
  const isServerError = apiError.status >= 500;

  const logPayload = {
    requestId,
    code: apiError.code,
    status: apiError.status,
    method: req.method,
    path: req.originalUrl,
    userId: req.sdkAuth?.authData.sub,
    clientId: req.sdkAuth?.clientId,
    err: apiError.cause ?? apiError,
  };
  if (isServerError) logger.error('[v1] request failed', logPayload);
  else logger.warn('[v1] request rejected', logPayload);

  if (apiError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(apiError.retryAfterSeconds));
  }

  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: isServerError ? 'An unexpected error occurred.' : apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      request_id: requestId,
      retryable: apiError.retryable,
      ...(apiError.retryAfterSeconds !== undefined
        ? { retry_after_seconds: apiError.retryAfterSeconds }
        : {}),
    },
  };

  res.status(apiError.status).json(body);
}

/** 404 for unmatched /v1 paths, in the v1 envelope rather than the legacy one. */
export function v1NotFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError('not_found', `No such endpoint: ${req.method} ${req.path}`));
}
