export class PauseStep extends Error {
  readonly externalRef: string | undefined;
  readonly statePatch: Record<string, unknown> | undefined;
  waitingStepName: string | undefined;

  constructor(
    reason: string,
    options?: {
      externalRef?: string;
      statePatch?: Record<string, unknown>;
      waitingStepName?: string;
    },
  ) {
    super(`Step paused: ${reason}`);
    this.name = 'PauseStep';
    this.externalRef = options?.externalRef;
    this.statePatch = options?.statePatch;
    this.waitingStepName = options?.waitingStepName;
  }

  static is(err: unknown): err is PauseStep {
    return err instanceof PauseStep || (err instanceof Error && err.name === 'PauseStep');
  }
}
