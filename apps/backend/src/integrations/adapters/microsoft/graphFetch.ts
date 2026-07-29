import { logger } from '@/utils/logger';

const TAG = '[MicrosoftGraph]';
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;

export async function graphFetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 429 && response.status !== 503) {
      return response;
    }
    lastResponse = response;
    if (attempt === MAX_RETRIES) break;

    const waitMs =
      parseRetryAfterMs(response.headers.get('Retry-After')) ??
      BACKOFF_BASE_MS * 2 ** attempt;
    logger.warn(
      `${TAG} ${response.status} throttled; sleeping ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
    );
    await sleep(waitMs);
  }
  return lastResponse!;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
