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
 */
export class SdkError extends Error {
  readonly code: SdkErrorCode;

  constructor(code: SdkErrorCode, message: string) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when authentication fails (401).
 */
export class AuthError extends SdkError {
  constructor(message = 'Authentication failed') {
    super('api_error', message);
    this.name = 'AuthError';
  }
}

/**
 * Thrown when a resource is not found (404).
 */
export class NotFoundError extends SdkError {
  constructor(message = 'Resource not found') {
    super('api_error', message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when rate limited (429).
 */
export class RateLimitError extends SdkError {
  readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super('api_error', message);
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
