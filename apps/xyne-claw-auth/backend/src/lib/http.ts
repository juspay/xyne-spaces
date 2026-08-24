import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

export { errMsg };

const log = createLogger("http");

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message = "Bad request", code?: string): HttpError => new HttpError(400, message, code);
export const unauthorized = (message = "Unauthorized", code?: string): HttpError => new HttpError(401, message, code);
export const forbidden = (message = "Forbidden", code?: string): HttpError => new HttpError(403, message, code);
export const notFound = (message = "Not found", code?: string): HttpError => new HttpError(404, message, code);
export const conflict = (message = "Conflict", code?: string): HttpError => new HttpError(409, message, code);

export function ok<T>(res: Response, data?: T, extra?: Record<string, unknown>): void {
  res.json({
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(extra ?? {}),
  });
}

export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next?: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}

export function errorMiddleware(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.extra ?? {}),
    });
    return;
  }
  log.error(`[unhandled] ${req.method} ${req.originalUrl}: ${errMsg(err)}`, err instanceof Error ? err.stack : undefined);
  res.status(500).json({ success: false, error: "Internal server error" });
}
