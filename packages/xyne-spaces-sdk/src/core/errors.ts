/**
 * SDK Error Types
 *
 * Provides typed error classes for different error scenarios.
 */

export type SdkErrorCode =
  | 'network_error'
  | 'timeout'
  | 'api_error'
  | 'forbidden'
  | 'validation_error'
  | 'unknown';

/**
 * Base error class for all SDK errors.
 *
 * `code` is the SDK's own coarse classification. `serverCode` is the precise code
 * the API returned in its error envelope — one of the 17 defined by
 * `@xyne/spaces-contract` (`insufficient_scope`, `idempotency_key_conflict`,
 * `mixed_update_fields`, …). Switch on `serverCode` when you need to tell apart
 * failures that share an HTTP status; the class hierarchy alone cannot.
 *
 * The contract is not imported here: it depends on zod, and this package ships
 * with no runtime dependencies. The string is passed through verbatim, and
 * `npm run contract-check` verifies the codes the SDK reasons about are real.
 */
export class SdkError extends Error {
  readonly code: SdkErrorCode;

  /** The API's `error.code`, when the failure came from the server. */
  readonly serverCode?: string;

  constructor(code: SdkErrorCode, message: string, serverCode?: string) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    if (serverCode !== undefined) this.serverCode = serverCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when authentication fails (401).
 */
export class AuthError extends SdkError {
  constructor(message = 'Authentication failed', serverCode?: string) {
    super('api_error', message, serverCode);
    this.name = 'AuthError';
  }
}

/**
 * Thrown when a resource is not found (404).
 */
export class NotFoundError extends SdkError {
  constructor(message = 'Resource not found', serverCode?: string) {
    super('api_error', message, serverCode);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when rate limited (429).
 */
export class RateLimitError extends SdkError {
  readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number, serverCode?: string) {
    super('api_error', message, serverCode);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when a Zero query or mutator fails.
 */
export class ZeroOperationError extends SdkError {
  readonly operationName: string;

  constructor(operationName: string, message: string) {
    super('api_error', `${operationName}: ${message}`);
    this.name = 'ZeroOperationError';
    this.operationName = operationName;
  }
}
