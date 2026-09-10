import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

export { errMsg };

const log = createLogger("http");

/**
 * Stable machine-readable codes for the standard JSON HTTP API.
 *
 * Protocol adapters with externally-defined response bodies (for example OAuth
 * device flow and Spaces app actions) deliberately do not use this contract.
 */
export const API_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  USER_SESSION_REQUIRED: "USER_SESSION_REQUIRED",
  SERVICE_AUTHENTICATION_REQUIRED: "SERVICE_AUTHENTICATION_REQUIRED",
  INVALID_SESSION_TOKEN: "INVALID_SESSION_TOKEN",
  ACCESS_TOKEN_NOT_ALLOWED: "ACCESS_TOKEN_NOT_ALLOWED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiErrorEnvelope {
  success: false;
  error: string;
  code: ApiErrorCode;
  [key: string]: unknown;
}

export interface ApiOkEnvelope<T> {
  success: true;
  data?: T;
  [key: string]: unknown;
}

function defaultCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 422:
      return API_ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return API_ERROR_CODES.AUTHENTICATION_REQUIRED;
    case 403:
      return API_ERROR_CODES.FORBIDDEN;
    case 404:
      return API_ERROR_CODES.NOT_FOUND;
    case 409:
      return API_ERROR_CODES.CONFLICT;
    case 429:
      return API_ERROR_CODES.RATE_LIMITED;
    case 502:
    case 503:
    case 504:
      return API_ERROR_CODES.UPSTREAM_ERROR;
    default:
      return API_ERROR_CODES.INTERNAL_ERROR;
  }
}

export class HttpError extends Error {
  public readonly code: ApiErrorCode;

  constructor(
    public readonly status: number,
    message: string,
    code?: ApiErrorCode,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code ?? defaultCodeForStatus(status);
  }
}

export const badRequest = (message = "Bad request", code: ApiErrorCode = API_ERROR_CODES.VALIDATION_FAILED): HttpError =>
  new HttpError(400, message, code);
export const unauthorized = (message = "Unauthorized", code: ApiErrorCode = API_ERROR_CODES.AUTHENTICATION_REQUIRED): HttpError =>
  new HttpError(401, message, code);
export const forbidden = (message = "Forbidden", code: ApiErrorCode = API_ERROR_CODES.FORBIDDEN): HttpError =>
  new HttpError(403, message, code);
export const notFound = (message = "Not found", code: ApiErrorCode = API_ERROR_CODES.NOT_FOUND): HttpError =>
  new HttpError(404, message, code);
export const conflict = (message = "Conflict", code: ApiErrorCode = API_ERROR_CODES.CONFLICT): HttpError =>
  new HttpError(409, message, code);

/** Send the canonical, backward-compatible JSON error envelope. */
export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message = "Request failed",
  extra?: Record<string, unknown>,
): void {
  const body: ApiErrorEnvelope = {
    ...(extra ?? {}),
    success: false,
    error: message,
    code,
  };
  res.status(status).json(body);
}

/** Send the canonical JSON success envelope. */
export function sendApiOk<T>(res: Response, data?: T, extra?: Record<string, unknown>): void {
  const body: ApiOkEnvelope<T> = {
    ...(extra ?? {}),
    success: true,
    ...(data !== undefined ? { data } : {}),
  };
  res.json(body);
}

/** @deprecated Prefer sendApiOk in new and migrated routes. */
export const ok = sendApiOk;

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
    sendApiError(res, err.status, err.code, err.message, err.extra);
    return;
  }
  log.error(`[unhandled] ${req.method} ${req.originalUrl}: ${errMsg(err)}`, err instanceof Error ? err.stack : undefined);
  sendApiError(res, 500, API_ERROR_CODES.INTERNAL_ERROR, "Internal server error");
}
