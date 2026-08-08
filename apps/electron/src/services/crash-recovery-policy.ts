/**
 * Pure, dependency-free policy for recovering the main window after a
 * renderer crash. Kept free of any `electron` imports so it can be unit-tested
 * in plain Node.
 *
 * Context: when the main renderer dies Electron leaves a blank window that only
 * a manual reload fixes. We auto-recover, but we must NOT reload forever if the
 * renderer is hard-failing on load — otherwise the app thrashes. This module
 * decides (a) whether a given crash reason is worth recovering and (b) whether
 * we are still within the retry budget.
 */

/**
 * Electron's `render-process-gone` reasons. A clean exit is a normal teardown
 * (e.g. window closing) and must never trigger a recovery reload.
 */
export type RenderProcessGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure';

/** A reason is recoverable if it is anything other than a clean teardown. */
export function shouldRecoverFromReason(reason: string): boolean {
  return reason !== 'clean-exit';
}

export interface RetryBudgetOptions {
  /** Max recovery attempts allowed inside the rolling window. */
  maxRetries: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
}

export const DEFAULT_RETRY_BUDGET: RetryBudgetOptions = {
  maxRetries: 3,
  windowMs: 60_000,
};

/**
 * Sliding-window retry budget. Records recovery attempts and reports whether a
 * new attempt is still permitted, so a renderer that keeps crashing on load
 * falls back to an error page instead of an infinite reload loop.
 */
export class CrashRetryBudget {
  private attempts: number[] = [];

  constructor(private readonly options: RetryBudgetOptions = DEFAULT_RETRY_BUDGET) {}

  /**
   * @returns true if a recovery attempt is allowed at time `now`. When allowed,
   * the attempt is recorded. When the budget is exhausted, nothing is recorded
   * and the caller should show a terminal error page.
   */
  tryConsume(now: number = Date.now()): boolean {
    const cutoff = now - this.options.windowMs;
    this.attempts = this.attempts.filter((t) => t > cutoff);
    if (this.attempts.length >= this.options.maxRetries) {
      return false;
    }
    this.attempts.push(now);
    return true;
  }

  /** Number of attempts still counted inside the current window. */
  attemptsInWindow(now: number = Date.now()): number {
    const cutoff = now - this.options.windowMs;
    return this.attempts.filter((t) => t > cutoff).length;
  }

  reset(): void {
    this.attempts = [];
  }
}
