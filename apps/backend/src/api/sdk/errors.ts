/**
 * Error plumbing for /api/sdk.
 *
 */

import {
  ERROR_CATALOG,
  isErrorCode,
  type ErrorCode,
  type ErrorDetail,
} from '@xyne/spaces-contract';
import { MutationACLError } from '@/zero/acl/core/types';
import { ZodError } from 'zod';

export class SdkApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly details?: readonly ErrorDetail[];
  /** Set when the underlying cause should be logged but never returned to the caller. */
  public readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: {
      details?: readonly ErrorDetail[];
      cause?: unknown;
    } = {},
  ) {
    const definition = ERROR_CATALOG[code];
    super(message ?? definition.description);
    this.name = 'SdkApiError';
    this.code = code;
    this.status = definition.status;
    this.retryable = definition.retryable;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.cause !== undefined) this.cause = opts.cause;
    Error.captureStackTrace(this, SdkApiError);
  }

  static validation(error: ZodError, prefix?: string): SdkApiError {
    const details: ErrorDetail[] = error.issues.map((issue) => ({
      path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.') || undefined,
      issue: issue.message,
    })) as ErrorDetail[];
    return new SdkApiError('validation_failed', 'Request failed schema validation.', { details });
  }

  static notFound(resource: string): SdkApiError {
    return new SdkApiError('not_found', `${resource} not found.`);
  }
}

/**
 * Translate anything thrown below the route layer into an SdkApiError.
 *
 * Ordering matters: ACL denials are a distinct 403 and must be checked before
 * the generic Error catch-all, otherwise they would surface as 400s.
 */
export function toSdkApiError(err: unknown): SdkApiError {
  if (err instanceof SdkApiError) return err;

  if (err instanceof ZodError) return SdkApiError.validation(err);

  if (err instanceof MutationACLError) {
    return new SdkApiError('forbidden', err.message, { cause: err });
  }

  // @rocicorp/zero's ApplicationError carries a structured `details` payload.
  // It is currently used by exactly one mutator; new domain errors should adopt
  // it so they can carry a specific code instead of the generic 400.
  if (isApplicationError(err)) {
    const code = extractCode(err.details);
    return new SdkApiError(code ?? 'validation_failed', err.message, {
      details: [{ issue: JSON.stringify(err.details) }],
      cause: err,
    });
  }

  if (err instanceof Error) {
    return new SdkApiError('validation_failed', err.message, { cause: err });
  }

  return new SdkApiError('internal', 'Unexpected error.', { cause: err });
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
    if (typeof raw === 'string' && isErrorCode(raw)) return raw;
  }
  return undefined;
}
