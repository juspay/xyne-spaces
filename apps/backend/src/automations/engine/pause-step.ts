export interface PauseBranchSegment {
  branchKey: string;
  index: number;
  stepName: string;
}

export class PauseStep extends Error {
  readonly externalRef: string | undefined;
  readonly statePatch: Record<string, unknown> | undefined;
  readonly branchPath: PauseBranchSegment[] = [];

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

export class TerminateRun extends Error {
  readonly reason: string | undefined;

  constructor(reason?: string) {
    super(reason ? `Run terminated: ${reason}` : 'Run terminated');
    this.name = 'TerminateRun';
    this.reason = reason;
  }

  static is(err: unknown): err is TerminateRun {
    return err instanceof TerminateRun || (err instanceof Error && err.name === 'TerminateRun');
  }
}
