import { AppError } from '../re-exports';

export type GatewayErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_SIGNATURE'
  | 'NOT_CONFIGURED'
  | 'ALREADY_CONFIGURED'
  | 'RATE_LIMITED'
  | 'LOCK_HELD'
  | 'PROVIDER_AUTH'
  | 'CHANNEL_GONE'
  | 'NOT_MESSAGE_AUTHOR'
  | 'NOT_PERMITTED'
  | 'JOB_NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

const STATUS: Record<GatewayErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_SIGNATURE: 401,
  NOT_CONFIGURED: 404,
  ALREADY_CONFIGURED: 409,
  RATE_LIMITED: 429,
  LOCK_HELD: 503,
  PROVIDER_AUTH: 502,
  CHANNEL_GONE: 502,
  NOT_MESSAGE_AUTHOR: 403,
  NOT_PERMITTED: 403,
  JOB_NOT_FOUND: 404,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

export interface GatewayErrorOptions {
  retryAfterMs?: number;
  providerCode?: string;
}

export class GatewayError extends AppError {
  readonly retryAfterMs?: number;
  readonly providerCode?: string;

  constructor(code: GatewayErrorCode, message: string, options?: GatewayErrorOptions);
  constructor(code: string, message: string, options: GatewayErrorOptions, statusCode: number);
  constructor(
    readonly code: string,
    message: string,
    options: GatewayErrorOptions = {},
    statusCode?: number
  ) {
    super(message, statusCode ?? STATUS[code as GatewayErrorCode]);
    this.name = 'GatewayError';
    this.retryAfterMs = options.retryAfterMs;
    this.providerCode = options.providerCode;
  }
}

const RETRYABLE: ReadonlySet<string> = new Set<GatewayErrorCode>([
  'RATE_LIMITED',
  'LOCK_HELD',
  'PROVIDER_ERROR',
  'INTERNAL',
]);

export function isRetryable(error: unknown): boolean {
  return !(error instanceof GatewayError) || RETRYABLE.has(error.code);
}
