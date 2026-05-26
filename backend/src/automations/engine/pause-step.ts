export class PauseStep extends Error {
  readonly externalRef: string | undefined;
  readonly statePatch: Record<string, unknown> | undefined;

  constructor(
    reason: string,
    options?: { externalRef?: string; statePatch?: Record<string, unknown> },
  ) {
    super(`Step paused: ${reason}`);
    this.name = 'PauseStep';
    this.externalRef = options?.externalRef;
    this.statePatch = options?.statePatch;
  }

  static is(err: unknown): err is PauseStep {
    return err instanceof PauseStep || (err instanceof Error && err.name === 'PauseStep');
  }
}
