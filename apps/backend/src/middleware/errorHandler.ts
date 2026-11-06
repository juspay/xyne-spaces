import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { logUrl } from '@/utils/logUrl';
import { ApiResponse } from '@/types/express';
import type { ZodError } from 'zod';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 400 naming the first bad field, e.g. "markdown: Required", instead of zod's JSON dump. */
export function zodErrorToAppError(error: ZodError, fallback = 'Invalid request'): AppError {
  const issue = error.issues[0];
  const location = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return new AppError(`${location}${issue?.message ?? fallback}`, 400);
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let error = err;
  const originalStack = err.stack;

  if (!(error instanceof AppError)) {
    const isJsonParseError =
      err instanceof SyntaxError &&
      typeof (err as { status?: unknown }).status === 'number' &&
      (err as { status?: number }).status === 400 &&
      'body' in (err as object);

    const statusCode = isJsonParseError ? 400 : 500;
    const message = err.message || 'Internal Server Error';
    error = new AppError(message, statusCode);
  }
  const appError = error as AppError;
  // Body-parser error messages and stacks quote the raw request body.
  const isBodyParseError = err instanceof SyntaxError && 'body' in (err as object);
  logger.error({
    message: isBodyParseError ? 'Malformed JSON request body' : appError.message,
    statusCode: appError.statusCode,
    error: isBodyParseError ? undefined : err,
    stack: isBodyParseError ? undefined : originalStack,
    wrapperStack: isBodyParseError || err instanceof AppError ? undefined : appError.stack,
    url: logUrl(req.originalUrl),
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  const response: ApiResponse = {
    success: false,
    error: appError.message,
    timestamp: new Date().toISOString(),
  };

  res.status(appError.statusCode).json(response);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ApiResponse = {
    success: false,
    error: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(response);
};
