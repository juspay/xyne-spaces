// Every /api/s2s failure: { error: { code, reason?, message, details?, request_id, retryable } }
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '@/utils/logger';
import { HTTP_STATUS, ServiceAccountError } from '@/serviceAccounts/errors';

interface Envelope {
  status: number;
  code: string;
  reason?: string;
  message: string;
  details?: { path?: string; issue: string }[];
  retryable: boolean;
  cause?: unknown;
}

function toEnvelope(err: unknown): Envelope {
  if (err instanceof ServiceAccountError) {
    return { status: HTTP_STATUS[err.code], code: err.code, reason: err.reason, message: err.message, retryable: false };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'validation_failed',
      message: 'Request failed validation.',
      details: err.issues.map((issue) => ({ path: issue.path.join('.') || undefined, issue: issue.message })),
      retryable: false,
    };
  }
  return { status: 500, code: 'internal', message: 'An unexpected error occurred.', retryable: true, cause: err };
}

export function s2sNotFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ServiceAccountError('not_found', `No such endpoint: ${req.method} ${req.path}`));
}

export function s2sErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const envelope = toEnvelope(err);
  const requestId = req.apiRequestId ?? 'unknown';
  const log = {
    requestId,
    code: envelope.code,
    reason: envelope.reason,
    status: envelope.status,
    method: req.method,
    path: req.originalUrl,
    serviceAccountId: req.serviceAccount?.id,
    err: envelope.cause ?? envelope.message,
  };
  if (envelope.status >= 500) logger.error('[s2s] request failed', log);
  else logger.warn('[s2s] request rejected', log);

  res.status(envelope.status).json({
    error: {
      code: envelope.code,
      ...(envelope.reason ? { reason: envelope.reason } : {}),
      message: envelope.message,
      ...(envelope.details ? { details: envelope.details } : {}),
      request_id: requestId,
      retryable: envelope.retryable,
    },
  });
}
