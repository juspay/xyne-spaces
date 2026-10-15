export type CancellableTask = {
  cancel: () => void;
};

export type RunAfterInteractions = (callback: () => void) => CancellableTask;

/**
 * Present a follow-up sheet after the current interaction (menu dismiss,
 * overlay animation) has finished. Replacing a pending callback, and
 * cancelling on unmount, keeps the sheet from opening after navigation.
 */
export function createMenuDismissScheduler(runAfterInteractions: RunAfterInteractions): {
  schedule: (present: () => void) => void;
  cancel: () => void;
} {
  let pending: CancellableTask | null = null;

  const cancel = (): void => {
    pending?.cancel();
    pending = null;
  };

  const schedule = (present: () => void): void => {
    cancel();
    pending = runAfterInteractions(() => {
      pending = null;
      present();
    });
  };

  return { schedule, cancel };
}
