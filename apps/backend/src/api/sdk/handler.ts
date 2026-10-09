/**
 * Request plumbing for /api/sdk: correlation, the per-call log line, and the
 * single error envelope.
 *
 * Every response leaving this API — success or failure — passes through here, so
 * the shape a caller sees, and the one line that records it, are decided in one
 * file rather than at each endpoint.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { REQUEST_ID_HEADER, type ApiErrorBody } from './errors';
import { logger } from '@/utils/logger';
import type { CustomRequest } from '@/types/express';
import { SdkApiError, toSdkApiError } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id echoed on every response and embedded in error envelopes. */
      apiRequestId?: string;
      /**
       * What this request ran, for the call log: an SDK operation id
       * (`messages.send`) or, for a path-addressed direct route, its pattern
       * (`GET /search`). Set by whichever handler resolves it.
       */
      sdkCall?: { op: string; kind: 'query' | 'mutator' | 'direct' | 'unknown' };
      /** The error `errorHandler` answered with, so the call log can carry its code and cause. */
      sdkError?: SdkApiError;
    }
  }
}

/**
 * The request's correlation id, echoed on success and failure alike.
 *
 * Reuses the id `requestLogger` already stamped on every log line for this
 * request (taken from the same `X-Request-Id` header, or minted there), so the id
 * a caller reads from an error envelope finds every line the request produced —
 * auth, the call log, and anything the mutator logged. Minting a second id here
 * would not even show up: the logger's context overwrites a payload `requestId`.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_ID_HEADER);
  const id =
    (req as CustomRequest).requestId ??
    (inbound && inbound.length <= 200 ? inbound : `req_${randomUUID()}`);
  req.apiRequestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/**
 * One structured line per /api/sdk call, written when the response finishes.
 *
 * Every field comes from the server — the verified session, the resolved
 * operation, the status written — never from a header the caller could set.
 * Bodies are never logged: arguments and results carry message text, emails and
 * ticket content. A 4xx is a warning and a 5xx an error, with the cause attached,
 * so this is also the only error log the API writes.
 *
 * Covers requests rejected before an operation resolved (auth failures, unknown
 * paths) too; their `op` is absent and `path` says what was asked for.
 */
export function callLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  let logged = false;

  const write = (aborted: boolean): void => {
    if (logged) return;
    logged = true;

    const status = aborted ? 499 : res.statusCode;
    const error = req.sdkError;
    const payload = {
      requestId: req.apiRequestId,
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId,
      op: req.sdkCall?.op,
      kind: req.sdkCall?.kind,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status,
      code: error?.code,
      durationMs: Date.now() - startedAt,
      ...(aborted ? { aborted: true } : {}),
      ...(error && status >= 500 ? { err: error.cause ?? error } : {}),
    };

    if (status >= 500) logger.error('[sdk] call', payload);
    else if (status >= 400) logger.warn('[sdk] call', payload);
    else logger.info('[sdk] call', payload);
  };

  res.once('finish', () => write(false));
  // A client that hangs up first never sees a status; record that it left.
  res.once('close', () => write(!res.writableFinished));
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
      next(err instanceof ZodError ? SdkApiError.validation(err) : err);
    });
  };
}

/** 404 for unmatched paths, in the SDK envelope rather than the app's. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new SdkApiError('not_found', `No such endpoint: ${req.method} ${req.path}`));
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

  const apiError = err instanceof SdkApiError ? err : toSdkApiError(err);
  const id = req.apiRequestId ?? 'unknown';
  const isServerError = apiError.status >= 500;

  // Logged by `callLog` once the response finishes, alongside the call it failed.
  req.sdkError = apiError;

  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: isServerError ? 'An unexpected error occurred.' : apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      request_id: id,
      retryable: apiError.retryable,
    },
  };

  res.status(apiError.status).json(body);
}
