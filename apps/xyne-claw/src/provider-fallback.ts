/**
 * Provider-fallback state machine — extracted from processTask so the decision
 * logic (empty-completion fallback, quota fallback, compact-before-fallback) is
 * isolated, dependency-free, and unit-testable. All I/O (running an attempt,
 * logging, metrics) is injected via callbacks; this file decides *what* to do,
 * not *how*.
 *
 * Behaviour it encodes (must stay faithful to the original loop):
 *  - Walk `attempts` in order. The first is the primary provider; the rest are
 *    fallbacks (provider chain → terminal "spaces").
 *  - An attempt that returns nothing user-visible (`producedNothing`) is a SOFT
 *    failure: if a fallback remains, compact the resumed session and try the
 *    next provider (so it doesn't inherit the over-window context that produced
 *    nothing). The LAST provider returning nothing is a terminal empty.
 *  - An attempt that THROWS is a hard failure: re-throw immediately unless it's
 *    a quota-exhaustion error AND a fallback remains, in which case continue.
 *    A user cancellation always re-throws.
 *  - If every attempt failed, throw the last error.
 */

export interface FallbackHooks {
  /** Called when about to try a fallback attempt (provider `from` → `to`). */
  onFallback?(from: string, to: string, lastErr: unknown): void;
  /** Called when an attempt produced nothing user-visible. `terminal` = no
   *  fallback remained, so this is the user-visible failure. */
  onEmpty?(provider: string, terminal: boolean): void;
  /** Called when an attempt succeeded after a prior fallback or guarded retry. */
  onRecovered?(provider: string): void;
  /** Called immediately before a guarded retry of the same provider. */
  onRetry?(provider: string, retry: number, error: unknown): void;
}

export interface FallbackOptions<A, R> {
  attempts: A[];
  /** Human label for an attempt (provider name) — used in hooks. */
  providerLabel: (a: A) => string;
  /** Run one attempt. `forceCompactBeforeRun` is true when the previous attempt
   *  returned empty (compact the resumed session first). `retryingTransient`
   *  is true only for a guarded same-provider retry. */
  runAttempt: (a: A, forceCompactBeforeRun: boolean, retryingTransient: boolean) => Promise<R>;
  /** True when a result is nothing the user can see (no text/attachments/etc). */
  producedNothing: (r: R) => boolean;
  /** True when an error is provider quota exhaustion (eligible for fallback). */
  isQuotaError: (err: unknown) => boolean;
  /** True when an error is a transient provider/network failure or a detected
   *  stall (eligible for fallback, same as quota). Optional — absent = treat
   *  only quota errors as fallback-eligible. */
  isTransientError?: (err: unknown) => boolean;
  /** A transient error is eligible for a same-provider retry only when this
   * predicate says it is safe. For example, a stall before any tool call can
   * be retried; a stall after side effects must fall through or fail instead. */
  canRetryTransient?: (err: unknown, attempt: A) => boolean;
  /** Maximum guarded retries of one provider attempt. Defaults to zero. */
  maxTransientRetriesPerAttempt?: number;
  /** Optional bounded delay before a guarded retry. */
  transientRetryDelayMs?: (retry: number, err: unknown, attempt: A) => number;
  /** True when an error is a user cancellation (never eligible for fallback). */
  isCancelled: (err: unknown) => boolean;
  hooks?: FallbackHooks;
}

export interface FallbackResult<A, R> {
  result: R;
  /** The attempt that ultimately succeeded. */
  completedAttempt: A;
  /** The provider we last fell back to, or null if the first attempt succeeded. */
  fellBackProvider: string | null;
}

export async function runWithProviderFallback<A, R>(
  opts: FallbackOptions<A, R>,
): Promise<FallbackResult<A, R>> {
  const {
    attempts,
    providerLabel,
    runAttempt,
    producedNothing,
    isQuotaError,
    isTransientError,
    canRetryTransient,
    maxTransientRetriesPerAttempt,
    transientRetryDelayMs,
    isCancelled,
    hooks,
  } = opts;

  let result: R | undefined;
  let completedAttempt: A | null = null;
  let fellBackProvider: string | null = null;
  let lastErr: unknown = undefined;
  let attemptedAny = false;
  // True when the previous attempt returned EMPTY — tells the next attempt to
  // compact the resumed session first so it doesn't re-overflow.
  let prevWasEmpty = false;

  providerLoop: for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    const hasFallbackLeft = i < attempts.length - 1;
    let transientRetryCount = 0;
    while (true) {
      try {
        if (attemptedAny) {
          // A same-provider retry is not a fallback. Do not misreport it as a
          // provider switch or overwrite the terminal provider label.
          if (transientRetryCount === 0) {
            fellBackProvider = providerLabel(a);
            const prev = i > 0 ? providerLabel(attempts[i - 1]!) : providerLabel(a);
            hooks?.onFallback?.(prev, providerLabel(a), lastErr);
          }
        }
        result = await runAttempt(a, prevWasEmpty, transientRetryCount > 0);

        if (producedNothing(result)) {
          if (hasFallbackLeft) {
            attemptedAny = true;
            prevWasEmpty = true;
            lastErr = new Error(`empty completion from ${providerLabel(a)}`);
            hooks?.onEmpty?.(providerLabel(a), false);
            continue providerLoop;
          }
          // Terminal empty — no fallback left; this is the user-visible failure.
          hooks?.onEmpty?.(providerLabel(a), true);
        }

        prevWasEmpty = false;
        completedAttempt = a;
        if (attemptedAny) hooks?.onRecovered?.(providerLabel(a));
        lastErr = undefined;
        return { result, completedAttempt, fellBackProvider };
      } catch (err) {
        attemptedAny = true;
        lastErr = err;
        // A thrown attempt was not an empty completion — clear the compact-before
        // flag so a quota fallback doesn't inherit a stale "compact first" from an
        // earlier empty two attempts back.
        prevWasEmpty = false;
        // Cancellation is always fatal. Otherwise, only quota exhaustion OR a
        // transient provider/network failure (incl. a detected stall) — with a
        // fallback remaining — continues to the next provider; anything else is
        // fatal. A hung provider now surfaces as a transient stall error here, so
        // it falls back instead of dropping the run silently.
        const eligible = isQuotaError(err) || (isTransientError?.(err) ?? false);
        if (isCancelled(err) || !eligible) throw err;
        const isTransient = isTransientError?.(err) ?? false;
        const retryLimit = Math.max(0, maxTransientRetriesPerAttempt ?? 0);
        if (
          isTransient
          && transientRetryCount < retryLimit
          && (canRetryTransient?.(err, a) ?? false)
        ) {
          transientRetryCount += 1;
          const delay = Math.max(0, transientRetryDelayMs?.(transientRetryCount, err, a) ?? 0);
          hooks?.onRetry?.(providerLabel(a), transientRetryCount, err);
          if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // Else fall through to the next provider (no forced compaction — matches
        // the quota-fallback contract; a hung/stalled attempt produced no partial
        // turn to compact away).
        break;
      }
    }
  }

  if (lastErr !== undefined) throw lastErr;
  // Loop guarantees result + completedAttempt are set when lastErr is undefined.
  return { result: result as R, completedAttempt: completedAttempt as A, fellBackProvider };
}
