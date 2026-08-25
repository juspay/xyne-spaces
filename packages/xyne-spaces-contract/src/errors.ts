/**
 * Error contract for the Xyne Spaces public API.
 *
 * `code` and the HTTP status are the API contract. `message` is human-readable
 * prose and MAY change between releases — the ~485 domain errors thrown inside
 * the mutator catalog are free text, so clients must branch on `code`, never on
 * message content.
 *
 * There are five codes, one per status, and the mapping is total: every failure
 * the API can produce lands on exactly one of them. That is deliberate. An
 * earlier version had twelve, of which three had no producer anywhere in the
 * codebase, one described a rate limiter that does not exist, and one promised
 * a `Retry-After` header nothing ever set — so callers were branching on
 * distinctions the server could not actually make. Five codes a client can
 * trust beat twelve it has to verify.
 *
 * Adding a sixth means adding a status. If two failures share a status, they
 * share a code and differ in `message`.
 */

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

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
