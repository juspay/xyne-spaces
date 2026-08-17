/**
 * Error plumbing for /api/sdk.
 *
 * Every failure path funnels through `ApiError`; `middleware/errorHandler.ts` is
 * the only place that writes a status code. Domain errors thrown inside the
 * mutator catalog are free-text (~485 `throw new Error` sites), so they map to
 * a single `domain_rule` code with the message passed through — clients branch
 * on `code`, never on message text.
 */

import { ERROR_CATALOG, type ErrorCode, type ErrorDetail } from '@xyne/spaces-contract';
import { MutationACLError } from '@/zero/acl/core/types';
import { ZodError } from 'zod';

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly details?: readonly ErrorDetail[];
  public readonly retryAfterSeconds?: number;
  /** Set when the underlying cause should be logged but never returned to the caller. */
  public readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: {
      details?: readonly ErrorDetail[];
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    const definition = ERROR_CATALOG[code];
    super(message ?? definition.description);
    this.name = 'ApiError';
    this.code = code;
    this.status = definition.status;
    this.retryable = definition.retryable;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.retryAfterSeconds !== undefined) this.retryAfterSeconds = opts.retryAfterSeconds;
    if (opts.cause !== undefined) this.cause = opts.cause;
    Error.captureStackTrace(this, ApiError);
  }

  static validation(error: ZodError, prefix?: string): ApiError {
    const details: ErrorDetail[] = error.issues.map((issue) => ({
      path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.') || undefined,
      issue: issue.message,
    })) as ErrorDetail[];
    return new ApiError('validation_failed', 'Request failed schema validation.', { details });
  }

  static notFound(resource: string): ApiError {
    return new ApiError('not_found', `${resource} not found.`);
  }
}

/**
 * Translate anything thrown below the route layer into an ApiError.
 *
 * Ordering matters: ACL denials are a distinct 403 and must be checked before
 * the generic Error catch-all, otherwise they would surface as 422 domain rules.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) return ApiError.validation(err);

  if (err instanceof MutationACLError) {
    return new ApiError('forbidden', err.message, { cause: err });
  }

  // @rocicorp/zero's ApplicationError carries a structured `details` payload.
  // It is currently used by exactly one mutator; new domain errors should adopt
  // it so they can carry a specific code instead of the generic domain_rule.
  if (isApplicationError(err)) {
    const code = extractCode(err.details);
    return new ApiError(code ?? 'domain_rule', err.message, {
      details: [{ issue: JSON.stringify(err.details) }],
      cause: err,
    });
  }

  if (err instanceof Error) {
    return new ApiError('domain_rule', err.message, { cause: err });
  }

  return new ApiError('internal', 'Unexpected error.', { cause: err });
}

interface ApplicationErrorLike {
  readonly name: string;
  readonly message: string;
  readonly details: unknown;
}

function isApplicationError(err: unknown): err is ApplicationErrorLike {
  return (
    err instanceof Error &&
    err.name === 'ApplicationError' &&
    'details' in err &&
    (err as { details?: unknown }).details !== undefined
  );
}

function extractCode(details: unknown): ErrorCode | undefined {
  if (details && typeof details === 'object' && 'code' in details) {
    const raw = (details as { code?: unknown }).code;
    if (typeof raw === 'string' && raw in ERROR_CATALOG) return raw as ErrorCode;
  }
  return undefined;
}
