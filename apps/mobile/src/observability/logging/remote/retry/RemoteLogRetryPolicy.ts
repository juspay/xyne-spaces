import { HttpRequestError } from '../http/HttpClient';
import { RemoteLogDeliveryError } from '../RemoteLogDeliveryError';
import { HttpRequestTimeoutError } from '../http/HttpRequestTimeoutError';

export type RemoteLogRetryPolicy = Readonly<{
  maximumAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
}>;

export const DEFAULT_REMOTE_LOG_RETRY_POLICY: RemoteLogRetryPolicy = {
  maximumAttempts: 3,
  initialDelayMs: 1_000,
  maximumDelayMs: 30_000,
};

const RETRYABLE_HTTP_STATUS_CODES: ReadonlySet<number> = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function validateRemoteLogRetryPolicy(policy: RemoteLogRetryPolicy): void {
  if (!isPositiveInteger(policy.maximumAttempts)) {
    throw new RangeError('Maximum retry attempts must be a positive integer.');
  }

  if (!isPositiveInteger(policy.initialDelayMs)) {
    throw new RangeError('Initial retry delay must be a positive integer.');
  }

  if (!isPositiveInteger(policy.maximumDelayMs)) {
    throw new RangeError('Maximum retry delay must be a positive integer.');
  }

  if (policy.initialDelayMs > policy.maximumDelayMs) {
    throw new RangeError('Initial retry delay must not exceed maximum retry delay.');
  }
}

export function isRetryableRemoteLogError(error: unknown): boolean {
  if (error instanceof HttpRequestError || error instanceof HttpRequestTimeoutError) {
    return true;
  }

  if (error instanceof RemoteLogDeliveryError) {
    return RETRYABLE_HTTP_STATUS_CODES.has(error.statusCode);
  }

  return false;
}

export function calculateRetryDelayMs(
  failedAttemptNumber: number,
  policy: RemoteLogRetryPolicy,
  randomValue: number = Math.random(),
): number {
  validateRemoteLogRetryPolicy(policy);

  if (!isPositiveInteger(failedAttemptNumber)) {
    throw new RangeError('Failed attempt number must be a positive integer.');
  }

  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new RangeError('Random value must be between 0 and 1.');
  }

  const exponentialDelay = policy.initialDelayMs * Math.pow(2, failedAttemptNumber - 1);

  const cappedDelay = Math.min(exponentialDelay, policy.maximumDelayMs);

  return Math.floor(randomValue * cappedDelay);
}
