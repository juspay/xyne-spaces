/**
 * Shared concurrency gate for direct LiteLLM calls (eval judge + extraction).
 *
 * The proxy key allows only a handful of parallel requests (currently 5) and is
 * shared with live agent runs. Before this gate, each call path (judge worker,
 * import extraction, run replays) throttled itself independently, so together
 * they routinely blew the cap and burned their retries on 429s. Every direct
 * eval LLM call now acquires a slot here, and 429s with a Retry-After are
 * respected once globally instead of per-caller.
 *
 * Tune with EVAL_LLM_MAX_CONCURRENT (default 2 — leaves headroom for agents).
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env["EVAL_LLM_MAX_CONCURRENT"] ?? 2));

let active = 0;
const waiters: Array<() => void> = [];
/** When a 429 told us to back off, no new call starts before this timestamp. */
let pausedUntil = 0;

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

/** Pause new acquisitions for `ms` (e.g. Retry-After from a 429). */
export function pauseLlmGate(ms: number): void {
  const until = Date.now() + Math.min(ms, 60_000); // cap a bad header at 60s
  if (until > pausedUntil) pausedUntil = until;
}

/** Run `fn` holding one of the shared LLM slots (waits for a free slot and for
 *  any active 429 backoff window). */
export async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return await fn();
  } finally {
    release();
  }
}

/** Parse a Retry-After header (seconds or HTTP-date) into milliseconds. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}
