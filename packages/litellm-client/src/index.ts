import { Agent, fetch as undiciFetch } from "undici";

// LiteLLM completions are non-streaming here: the gateway can send response
// headers only after generating the full completion. Disable undici's default
// headers/body timeouts so the caller's per-attempt timeout is the sole clock.
// A genuinely unreachable gateway still fails quickly during connection setup.
const llmDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 10_000,
});

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

export interface LiteLLMRetryEvent {
  label: string;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status?: number;
  error?: unknown;
}

export interface LiteLLMFetchOptions {
  /** Timeout applied independently to every request attempt. */
  timeoutMs: number;
  /** Operation name included in retry diagnostics. */
  label: string;
  /** Retries after the initial request. Defaults to 3; use 0 for single-shot. */
  maxRetries?: number;
  /** Optional structured retry hook. Defaults to a concise console warning. */
  onRetry?: (event: LiteLLMRetryEvent) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, response: UndiciResponse | undefined): number {
  // Honor Retry-After when LiteLLM sends one (seconds); otherwise use
  // 5s/15s/45s exponential backoff with ±20% jitter.
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 60_000);
  }

  const base = 5_000 * Math.pow(3, attempt);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.min(base * jitter, 60_000);
}

function logRetry(event: LiteLLMRetryEvent): void {
  const reason =
    event.status !== undefined
      ? `status=${event.status}`
      : `error=${event.error instanceof Error ? event.error.message : String(event.error)}`;
  console.warn(
    `[litellm-retry] ${event.label}: ${reason} — retry ${event.attempt}/${event.maxRetries} in ${Math.round(event.delayMs / 1_000)}s`,
  );
}

/**
 * Fetch a LiteLLM endpoint with a caller-controlled per-attempt timeout.
 *
 * Retries 429/500/502/503/504 responses and network-level failures. Returns
 * the final HTTP response even when it is non-OK; throws only when every
 * attempt failed before receiving a response.
 */
export async function fetchLiteLLMWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  options: LiteLLMFetchOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }

  let lastError: unknown;
  let lastResponse: UndiciResponse | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = backoffMs(attempt - 1, lastResponse);
      const event: LiteLLMRetryEvent = {
        label: options.label,
        attempt,
        maxRetries,
        delayMs,
        ...(lastResponse ? { status: lastResponse.status } : { error: lastError }),
      };
      (options.onRetry ?? logRetry)(event);
      await sleep(delayMs);
    }

    try {
      const response = await undiciFetch(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: llmDispatcher,
      } as Parameters<typeof undiciFetch>[1]);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response as unknown as Response;
      }

      // The caller never sees intermediate retry responses. Release their
      // bodies so the dispatcher can reuse the connection during backoff.
      await response.body?.cancel().catch(() => undefined);
      lastResponse = response;
      lastError = undefined;
    } catch (error) {
      lastError = error;
      lastResponse = undefined;
    }
  }

  // HTTP responses return from inside the loop; reaching here means every
  // attempt failed before a response was received.
  throw lastError;
}

/** Semantic alias for callers that select retry behavior through maxRetries. */
export const fetchLiteLLM = fetchLiteLLMWithRetry;
