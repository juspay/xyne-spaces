import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

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

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let error = err;

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
  logger.error({
    message: appError.message,
    statusCode: appError.statusCode,
    stack: appError.stack,
    originalError: err instanceof AppError ? undefined : err.message,
    originalStack: err instanceof AppError ? undefined : err.stack,
    url: req.url,
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