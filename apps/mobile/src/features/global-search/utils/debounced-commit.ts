/**
 * A debounce with a quiet period and a ceiling, driven from the input event.
 *
 * The ceiling is measured from the first uncommitted keystroke and later keystrokes
 * do not reset it. Without it, someone who never pauses for the full quiet period
 * never searches at all.
 */

export type DebouncedCommitter<T> = {
  /** Record a new value. Schedules a commit honouring both `wait` and `maxWait`. */
  push: (value: T) => void;
  /** Commit whatever is pending right now (submit button, blur, unmount-with-intent). */
  flush: () => void;
  /** Drop whatever is pending without committing (screen teardown). */
  cancel: () => void;
};

export type DebouncedCommitOptions = {
  /** Quiet period after the last keystroke. */
  waitMs: number;
  /**
   * Hard ceiling from the first un-committed keystroke. A value is never held back
   * longer than this, no matter how fast the user keeps typing.
   */
  maxWaitMs: number;
};

export function createDebouncedCommitter<T>(
  commit: (value: T) => void,
  { waitMs, maxWaitMs }: DebouncedCommitOptions,
): DebouncedCommitter<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  /** When the current un-committed burst started. 0 means "no burst in progress". */
  let burstStartedAt = 0;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const fire = (): void => {
    clear();
    const current = pending;
    pending = null;
    burstStartedAt = 0;
    if (current) commit(current.value);
  };

  return {
    push(value: T): void {
      pending = { value };

      const now = Date.now();
      if (burstStartedAt === 0) burstStartedAt = now;

      // The delay is whichever comes first: a full quiet period, or the remaining
      // budget before this burst hits its ceiling. `maxWaitMs` is measured from
      // `burstStartedAt`, which keystrokes deliberately do NOT reset.
      const elapsed = now - burstStartedAt;
      const delay = Math.max(0, Math.min(waitMs, maxWaitMs - elapsed));

      clear();
      timer = setTimeout(fire, delay);
    },

    flush(): void {
      if (pending !== null) fire();
      else clear();
    },

    cancel(): void {
      clear();
      pending = null;
      burstStartedAt = 0;
    },
  };
}

/** 250ms of quiet, but never hold a query back for more than 700ms. */
export const SEARCH_COMMIT_WAIT_MS = 250;
export const SEARCH_COMMIT_MAX_WAIT_MS = 700;
