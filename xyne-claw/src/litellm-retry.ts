import { createLogger } from "./logger.js";
const log = createLogger("litellm-retry");

/**
 * LiteLLM fetch with 429/5xx retry — for the offline curator paths.
 *
 * Why: the nightly memory-cron walks hundreds of sessions sequentially; each
 * curator call is a bare fetch with NO retry. When the shared LiteLLM key's
 * max_parallel_requests slots are saturated (long agent decode streams hold
 * them), every curator call 429s INSTANTLY and the loop rapid-fires through
 * the whole night's sessions in minutes, silently losing all curation
 * (397 sessions lost in 10 min on 2026-06-10, prod logs). A short backoff is
 * all that's needed — the saturation windows are transient.
 *
 * NOT for the interactive agent loop — pi has its own auto-retry there.
 */

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, res: Response | undefined): number {
  // Honor Retry-After when LiteLLM sends one (seconds); else 5s/15s/45s ±20%.
  const retryAfter = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  const base = 5_000 * Math.pow(3, attempt);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.min(base * jitter, 60_000);
}

/**
 * fetch() against LiteLLM with per-attempt timeout and retry on 429/5xx.
 * Returns the final Response (possibly still non-OK after retries exhaust);
 * throws only when every attempt failed at the network layer.
 */
export async function fetchLiteLLMWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  opts: { timeoutMs: number; label: string; maxRetries?: number },
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = backoffMs(attempt - 1, lastResponse);
      log.warn(
        `[litellm-retry] ${opts.label}: ${lastResponse ? `status=${lastResponse.status}` : `error=${lastError instanceof Error ? lastError.message : String(lastError)}`} — retry ${attempt}/${maxRetries} in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!RETRYABLE_STATUSES.has(res.status)) return res;
      lastResponse = res;
      lastError = undefined;
    } catch (err) {
      lastError = err;
      lastResponse = undefined;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}
