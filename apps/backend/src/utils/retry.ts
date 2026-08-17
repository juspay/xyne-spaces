import { logger } from '@/utils/logger';

const CONNECTION_ERROR_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const CONNECTION_ERROR_MESSAGES = ["Connection is closed", "Stream isn't writeable", 'READONLY'];

export function isConnectionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errorCode?: unknown; name?: unknown; message?: unknown };

  const code =
    typeof e.code === 'string' ? e.code : typeof e.errorCode === 'string' ? e.errorCode : '';
  if (CONNECTION_ERROR_CODES.has(code)) return true;

  if (e.name === 'MaxRetriesPerRequestError') return true;

  const message = typeof e.message === 'string' ? e.message : '';
  if (CONNECTION_ERROR_MESSAGES.some(m => message.includes(m))) return true;
  for (const c of CONNECTION_ERROR_CODES) {
    if (message.includes(c)) return true;
  }
  return false;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.floor(Math.random() * ceiling);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const attempts = envInt('RETRY_ATTEMPTS', 3);
  const baseDelayMs = envInt('RETRY_BASE_DELAY_MS', 200);
  const maxDelayMs = envInt('RETRY_MAX_DELAY_MS', 5_000);

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isConnectionError(err)) throw err;

      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      logger.warn('Retrying after connection error', {
        label,
        attempt,
        delayMs,
        message: (err as { message?: string })?.message,
      });
      await sleep(delayMs);
    }
  }
}

export async function retryForever<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const baseDelayMs = envInt('RETRY_BASE_DELAY_MS', 200);
  const maxDelayMs = envInt('CONNECT_RETRY_MAX_DELAY_MS', 30_000);

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      const detail = { label, attempt, delayMs, message: (err as { message?: string })?.message };
      if (attempt % 10 === 0) {
        logger.error('Still unable to connect; retrying indefinitely', detail);
      } else {
        logger.warn('Connection failed, retrying', detail);
      }
      await sleep(delayMs);
    }
  }
}
