import { Prisma } from '@prisma/client';

/**
 * Marks an error as safe to retry. Thrown from steps/services when the caller
 * knows the failure is environmental (network, downstream 5xx, timeout) rather
 * than a config/data problem that would fail identically on every re-run.
 */
export class RetryableError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RetryableError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class DataNotReadyError extends RetryableError {
  constructor(entityType: string, entityId: string) {
    super(`${entityType} ${entityId} is not available yet`);
    this.name = 'DataNotReadyError';
  }
}

/**
 * Prisma codes worth retrying:
 *  P1001/P1002  DB unreachable / connection timeout
 *  P2024        connection pool timeout (hot spot)
 *  P2034        transaction conflict / deadlock (lost update race)
 * NOTE P2002 (unique constraint) is intentionally NOT retryable: the duplicate
 * row will still exist on the next attempt.
 * NOTE P2025 is intentionally NOT global. Trigger hydration converts a missing
 * primary event entity to DataNotReadyError; action/config lookups stay terminal.
 */
const RETRYABLE_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P2024',
  'P2034',
]);

const NETWORK_ERROR_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'FetchError', // node-fetch
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN', // DNS
  'EPIPE',
  'EHOSTUNREACH',
]);

function hasCode(value: unknown): value is { code: unknown } {
  return typeof value === 'object' && value !== null && 'code' in value;
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof RetryableError) return true;

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    RETRYABLE_PRISMA_CODES.has(err.code)
  ) {
    return true;
  }

  if (err instanceof Error) {
    if (NETWORK_ERROR_NAMES.has(err.name)) return true;

    if (hasCode(err) && typeof err.code === 'string') {
      if (NETWORK_ERROR_CODES.has(err.code)) return true;
      if (RETRYABLE_PRISMA_CODES.has(err.code)) return true;
    }

    // Downstream HTTP 5xx / rate limit surfaced as a plain Error with a status.
    const status =
      (err as { status?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && (status >= 500 || status === 429)) {
      return true;
    }

    // node fetch on network failure: TypeError "fetch failed" with a cause that
    // carries the real errno code.
    if (err.name === 'TypeError' && typeof err.message === 'string') {
      const cause = (err as { cause?: unknown }).cause;
      if (cause && hasCode(cause) && typeof cause.code === 'string') {
        if (NETWORK_ERROR_CODES.has(cause.code)) return true;
      }
      if (/fetch failed|network|socket hang up|terminated/i.test(err.message)) {
        return true;
      }
    }
  }

  return false;
}

/** Bull stall-exhaustion failures must NOT be retry-reset: the job is already
 * terminally failed inside Bull (stall path never increments attemptsMade and
 * never re-runs), so "FAILED→PENDING for retry" would strand the run in PENDING
 * with no queue job to pick it up. Detect by Bull's exact reason string. */
export function isStallExhaustionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('stalled more than allowable limit');
}
