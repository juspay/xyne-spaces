export type DeferralScope = 'chat-open';

/** Low hundreds of ms — not the v2 10 s global window (B9). */
export const CHAT_OPEN_DEFERRAL_MS = 400;

export type DeferralClock = {
  now: () => number;
  setTimeout: (work: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

const defaultClock: DeferralClock = {
  now: Date.now,
  setTimeout,
  clearTimeout,
};

export type DeferralToken = {
  readonly scope: DeferralScope;
  readonly budgetMs: number;
  readonly acquiredAt: number;
  isActive: () => boolean;
  defer: (name: string, work: () => void) => void;
  release: () => void;
};

/**
 * Scoped hold for named non-critical work. Released from the machine's single
 * teardown path (or when the budget elapses). Not a global "hold everything"
 * gate — callers opt in via `defer`.
 */
export const acquireDeferral = (
  scope: DeferralScope,
  budgetMs: number,
  clock: DeferralClock = defaultClock,
): DeferralToken => {
  let released = false;
  const queued: Array<() => void> = [];
  const acquiredAt = clock.now();
  const timer = clock.setTimeout((): void => {
    flush();
  }, budgetMs);

  const flush = (): void => {
    if (released) {
      return;
    }
    released = true;
    clock.clearTimeout(timer);
    const jobs = queued.splice(0);
    for (const job of jobs) {
      job();
    }
  };

  return {
    scope,
    budgetMs,
    acquiredAt,
    isActive: (): boolean => !released,
    defer: (_name: string, work: () => void): void => {
      if (released) {
        work();
        return;
      }
      queued.push(work);
    },
    release: flush,
  };
};
