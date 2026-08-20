/**
 * Error contract for the Xyne Spaces public API.
 *
 * `code` and the HTTP status are the API contract. `message` is human-readable
 * prose and MAY change between releases — the ~485 domain errors thrown inside
 * the mutator catalog are free text, so clients must branch on `code`, never on
 * message content.
 */

export const ERROR_CODES = [
  'validation_failed',
  'invalid_request',
  'unauthenticated',
  'token_expired',
  'forbidden',
  'not_found',
  'domain_rule',
  'conflict',
  'rate_limited',
  'internal',
  'service_misconfigured',
  'upstream_unavailable',
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
    description: 'Request body, path, or query parameters failed schema validation.',
  },
  invalid_request: {
    status: 400,
    retryable: false,
    description: 'The request was structurally invalid (malformed JSON, bad cursor, unknown view).',
  },
  unauthenticated: {
    status: 401,
    retryable: false,
    description: 'Missing, malformed, or unverifiable access token.',
  },
  token_expired: {
    status: 401,
    retryable: false,
    description: 'The access token has expired. Refresh and retry; SDK clients do this automatically.',
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
      'The resource does not exist, or is not visible to the acting user. These are deliberately indistinguishable.',
  },
  domain_rule: {
    status: 422,
    retryable: false,
    description: 'A business rule rejected the operation. See `message` for the human-readable reason.',
  },
  conflict: {
    status: 409,
    retryable: false,
    description: 'The operation conflicts with the current state of the resource.',
  },
  rate_limited: {
    status: 429,
    retryable: true,
    description: 'Rate limit exceeded. Honour the Retry-After header.',
  },
  internal: {
    status: 500,
    retryable: true,
    description: 'Unexpected server error.',
  },
  service_misconfigured: {
    status: 503,
    retryable: false,
    description:
      'A required dependency is not configured for this deployment (for example, the read replica pool).',
  },
  upstream_unavailable: {
    status: 503,
    retryable: true,
    description: 'A downstream dependency (database, search) is temporarily unavailable.',
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
    readonly retry_after_seconds?: number;
    readonly doc_url?: string;
  };
}

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
