export interface Sleeper {
  sleep(durationMs: number): Promise<void>;
}

export class SystemSleeper implements Sleeper {
  sleep(durationMs: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, durationMs);
    });
  }
}
