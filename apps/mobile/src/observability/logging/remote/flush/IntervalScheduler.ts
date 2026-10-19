export interface ScheduledInterval {
  cancel(): void;
}

export interface IntervalScheduler {
  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledInterval;
}

export class SystemIntervalScheduler implements IntervalScheduler {
  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledInterval {
    const intervalHandle = setInterval(callback, intervalMs);

    return {
      cancel: (): void => {
        clearInterval(intervalHandle);
      },
    };
  }
}
