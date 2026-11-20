/**
 * Shared request-validation primitives for the runtime's routes.
 *
 * Callers are internal and authenticated, so a body that fails to parse is a
 * bug or an attack, never routine traffic: reject loudly, naming the field.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../logger.js";
import { isSafeId } from "../../safe-id.js";

const log = createLogger("route-schema");

/** Longest an identifier may be before it is certainly not one. */
const MAX_IDENTIFIER = 256;

/** Trimmed, present, and bounded — the shape every free-text field starts from. */
export const nonEmptyString = z.string().trim().min(1);

/** Bounded and present. No charset — use `safeId` for anything reaching a
 *  filesystem path or a callback URL. */
const identifier = z.string().trim().min(1).max(MAX_IDENTIFIER);

/**
 * `/^[A-Za-z0-9_-]{1,128}$/` via safe-id.ts, so nothing reaching `path.join`
 * can traverse. Do NOT add `.trim()` — the guards this replaces ran on the raw
 * string, so trimming would start accepting ids that are rejected today.
 */
export const safeId = z.string().refine(isSafeId, { error: "has invalid format" });

/** `safeId` for a value the handler trimmed before checking — sessionId only. */
export const trimmedSafeId = z.string().trim().refine(isSafeId, { error: "has invalid format" });

/** Present once trimmed, passed through unchanged: the guards this replaces
 *  tested `.trim()` but forwarded the ORIGINAL string. */
export const nonBlankString = z
  .string()
  .refine((value) => value.trim().length > 0, { error: "must be a non-empty string" });

export const sessionId = identifier;

/** Rejects anything longer than `max`. Use where oversize input is a caller bug. */
export function boundedText(max: number): z.ZodString {
  return z.string().max(max);
}

/**
 * Truncates instead of rejecting, preserving what the handlers do today with
 * `.slice(0, 4_000)`. Use when tightening to `boundedText` would turn input
 * that works now into a 400.
 */
export function truncatedText(max: number): z.ZodPipe<z.ZodString, z.ZodTransform<string, string>> {
  return z.string().transform((value) => value.slice(0, max));
}

/** Where `validate` leaves parsed query and params. Body is written back in
 *  place. Module-private: read them through `validatedQuery`/`validatedParams`. */
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

/**
 * `unrecognized_keys` carries an empty `path` and names the offending keys in
 * `keys`, so it needs its own branch or the message degrades to a bare
 * "Unrecognized key" with nothing to act on.
 */
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

/**
 * Rejects with the house error shape (400) on the first failure.
 *
 * Parsed body replaces `req.body`. Query and params go to `res.locals`
 * instead — `req.query` is a getter with no setter under Express 5, and this
 * package is typed against @types/express 5 while running on Express 4.
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

/**
 * Logs body keys a schema does not declare, without rejecting them, so the
 * declared set can be completed from real traffic and tightened later.
 * Key names only, never values — bodies carry user content.
 */
export function reportUndeclaredBodyKeys(schema: z.ZodObject<z.ZodRawShape>, label: string) {
  const declared = new Set(Object.keys(schema.shape));
  return function reportUndeclaredBodyKeysMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const body: unknown = req.body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const undeclared = Object.keys(body as Record<string, unknown>).filter((key) => !declared.has(key));
      if (undeclared.length > 0) {
        log.warn(`[validate] ${label}: undeclared keys ${undeclared.join(", ")}`);
      }
    }
    next();
  };
}

function reject(req: Request, res: Response, error: z.ZodError, source: string): void {
  const detail = describeError(error, source);
  const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  log.warn(`[validate] rejected ${req.method} ${path}: ${detail}`);
  res.status(400).json({ success: false, error: detail });
}
