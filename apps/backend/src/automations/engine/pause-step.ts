export type BranchKey =
  | { kind: 'if_true' }
  | { kind: 'if_false' }
  | { kind: 'default' }
  | { kind: 'case'; index: number };

export function branchKeyToString(key: BranchKey): string {
  return key.kind === 'case' ? `case_${key.index}` : key.kind;
}

export function branchKeyEquals(a: BranchKey, b: BranchKey): boolean {
  if (a.kind === 'case') return b.kind === 'case' && a.index === b.index;
  return a.kind === b.kind;
}

export interface PauseBranchSegment {
  branchKey: BranchKey;
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
