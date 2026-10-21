import { AppError } from '../re-exports';

export type GatewayErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_SIGNATURE'
  | 'NOT_CHANNEL_MEMBER'
  | 'NOT_CONFIGURED'
  | 'LINK_NOT_FOUND'
  | 'ALREADY_CONFIGURED'
  | 'CHANNEL_TAKEN'
  | 'RATE_LIMITED'
  | 'LOCK_HELD'
  | 'PROVIDER_AUTH'
  | 'CHANNEL_GONE'
  | 'NOT_MESSAGE_AUTHOR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

const STATUS: Record<GatewayErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_SIGNATURE: 401,
  NOT_CHANNEL_MEMBER: 403,
  NOT_CONFIGURED: 404,
  LINK_NOT_FOUND: 404,
  ALREADY_CONFIGURED: 409,
  CHANNEL_TAKEN: 409,
  RATE_LIMITED: 429,
  LOCK_HELD: 503,
  PROVIDER_AUTH: 502,
  CHANNEL_GONE: 502,
  NOT_MESSAGE_AUTHOR: 403,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

export interface GatewayErrorOptions {
  retryAfterMs?: number;
  /** The provider's own error code, e.g. Slack's `channel_not_found`. */
  providerCode?: string;
}

export class GatewayError extends AppError {
  readonly retryAfterMs?: number;
  readonly providerCode?: string;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    options: GatewayErrorOptions = {}
  ) {
    super(message, STATUS[code]);
    this.name = 'GatewayError';
    this.retryAfterMs = options.retryAfterMs;
    this.providerCode = options.providerCode;
  }
}

/** Errors that pause a link instead of being retried. */
export function isPausingError(error: unknown): error is GatewayError {
  return (
    error instanceof GatewayError &&
    (error.code === 'PROVIDER_AUTH' || error.code === 'CHANNEL_GONE')
  );
}
