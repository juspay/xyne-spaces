export class PauseStep extends Error {
  readonly externalRef: string | undefined;

  constructor(reason: string, options?: { externalRef?: string }) {
    super(`Step paused: ${reason}`);
    this.name = 'PauseStep';
    this.externalRef = options?.externalRef;
  }

  static is(err: unknown): err is PauseStep {
    return err instanceof PauseStep || (err instanceof Error && err.name === 'PauseStep');
  }
}
