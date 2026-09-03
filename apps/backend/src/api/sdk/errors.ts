/**
 * The error contract for /api/sdk, and the plumbing that produces it.
 *
 * `code` and the HTTP status are the contract. `message` is human-readable prose
 * and MAY change between releases — the ~485 domain errors thrown inside the
 * mutator catalog are free text, so clients must branch on `code`, never on
 * message content.
 *
 * There are five codes, one per status, and the mapping is total: every failure
 * the API can produce lands on exactly one of them. Adding a sixth means adding
 * a status. If two failures share a status, they share a code and differ in
 * `message`.
 */

import { MutationACLError } from '@/zero/acl/core/types';
import { ZodError } from 'zod';

export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDefinition {
  readonly status: number;
  /** Safe to replay the identical request? */
  readonly retryable: boolean;
  readonly description: string;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  validation_failed: {
    status: 400,
    retryable: false,
    description:
      'The request was rejected on its inputs: schema validation failed, or a business rule refused the operation. `message` says which, and is meant to be shown.',
  },
  unauthenticated: {
    status: 401,
    retryable: false,
    description:
      'The API key is missing, malformed, unverifiable, expired, or revoked. These are deliberately indistinguishable — mint a new key from the dashboard.',
  },
  forbidden: {
    status: 403,
    retryable: false,
    description: 'The acting user is not permitted to perform this operation on this resource.',
  },
  not_found: {
    status: 404,
    retryable: false,
    description:
      'No such endpoint, catalog operation, or resource — or the resource is not visible to the acting user. Existence and visibility are deliberately indistinguishable.',
  },
  internal: {
    status: 500,
    retryable: true,
    description:
      'Anything else: an unexpected server error, an unconfigured dependency, or a downstream outage. The message is replaced with a generic string; the cause is logged against `request_id`.',
  },
};

export interface ErrorDetail {
  readonly path?: string;
  readonly issue: string;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
    readonly request_id: string;
    readonly retryable: boolean;
  };
}

/** Correlation id, echoed on every response and carried in error envelopes. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

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
