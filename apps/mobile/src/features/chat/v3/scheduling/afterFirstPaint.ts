/**
 * §8.1 reuse gate: **Adopt** v2 `runAfterFirstPaint` (double-rAF). Constraint
 * (R7): heuristic only — never for correctness, only non-critical work.
 */

export type AnimationFrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
};

const defaultScheduler: AnimationFrameScheduler = {
  request: (callback: () => void): number => requestAnimationFrame(callback),
  cancel: (id: number): void => {
    cancelAnimationFrame(id);
  },
};

export const runAfterFirstPaint = (
  callback: () => void,
  scheduler: AnimationFrameScheduler = defaultScheduler,
): { cancel: () => void } => {
  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  firstFrame = scheduler.request((): void => {
    if (cancelled) {
      return;
    }
    secondFrame = scheduler.request((): void => {
      if (!cancelled) {
        callback();
      }
    });
  });

  return {
    cancel: (): void => {
      cancelled = true;
      if (firstFrame !== null) {
        scheduler.cancel(firstFrame);
      }
      if (secondFrame !== null) {
        scheduler.cancel(secondFrame);
      }
    },
  };
};
