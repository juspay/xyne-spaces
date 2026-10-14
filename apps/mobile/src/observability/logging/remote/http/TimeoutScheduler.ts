export interface ScheduledTimeout {
  cancel(): void;
}

export interface TimeoutScheduler {
  schedule(callback: () => void, durationMs: number): ScheduledTimeout;
}

export class SystemTimeoutScheduler implements TimeoutScheduler {
  schedule(callback: () => void, durationMs: number): ScheduledTimeout {
    const timeoutHandle = setTimeout(callback, durationMs);

    return {
      cancel: () => {
        clearTimeout(timeoutHandle);
      },
    };
  }
}
