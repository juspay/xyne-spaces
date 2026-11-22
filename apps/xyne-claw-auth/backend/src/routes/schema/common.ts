/**
 * Shared request-validation primitives for claw-auth routes.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createLogger, createTraceId } from "../../logger.js";

const log = createLogger("route-schema", createTraceId());

/** Present once trimmed, passed through unchanged. */
export const nonBlankString = z
  .string()
  .refine((value) => value.trim().length > 0, { error: "must be a non-empty string" });

/** Path or query identifier: present and bounded. */
export const identifier = z.string().min(1).max(256);

/** Page size from a query string: defaults to `def`, capped at `max`. */
export function pageLimit(def: number, max: number) {
  return z.coerce.number().int().min(1).optional().transform((value) => Math.min(value ?? def, max));
}

/** Page offset from a query string. */
export const pageOffset = z.coerce.number().int().min(0).default(0);

/** Where `validate` leaves parsed query and params. Body is written back in place. */
const VALIDATED_QUERY = "validatedQuery";
const VALIDATED_PARAMS = "validatedParams";

export function validatedQuery<T>(res: Response): T {
  return res.locals[VALIDATED_QUERY] as T;
}

export function validatedParams<T>(res: Response): T {
  return res.locals[VALIDATED_PARAMS] as T;
}

export interface ValidationSpec {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

function describeIssue(issue: z.ZodError["issues"][number], source: string): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : source;
  if (issue.code === "unrecognized_keys") {
    return `${path}: unknown ${issue.keys.length > 1 ? "fields" : "field"} ${issue.keys.join(", ")}`;
  }
  return `${path}: ${issue.message}`;
}

function describeError(error: z.ZodError, source: string): string {
  return error.issues.map((issue) => describeIssue(issue, source)).join("; ");
}

function reject(req: Request, res: Response, error: z.ZodError, source: string): void {
  const detail = describeError(error, source);
  const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  log.warn(`[validate] rejected ${req.method} ${path}: ${detail}`);
  res.status(400).json({ success: false, error: detail });
}

/**
 * Parses body, query and params against the given schemas and answers 400 on
 * the first failure. The parsed body replaces `req.body`; parsed query and
 * params go to `res.locals` (read them with `validatedQuery`/`validatedParams`).
 */
export function validate(spec: ValidationSpec) {
  return function validateMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (spec.body) {
      const parsed = spec.body.safeParse(req.body ?? {});
      if (!parsed.success) {
        reject(req, res, parsed.error, "body");
        return;
      }
      req.body = parsed.data;
    }

    if (spec.query) {
      const parsed = spec.query.safeParse(req.query ?? {});
      if (!parsed.success) {
        reject(req, res, parsed.error, "query");
        return;
      }
      res.locals[VALIDATED_QUERY] = parsed.data;
    }

    if (spec.params) {
      const parsed = spec.params.safeParse(req.params ?? {});
      if (!parsed.success) {
        reject(req, res, parsed.error, "params");
        return;
      }
      res.locals[VALIDATED_PARAMS] = parsed.data;
    }

    next();
  };
}
