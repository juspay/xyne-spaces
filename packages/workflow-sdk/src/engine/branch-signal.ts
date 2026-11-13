/**
 * A structured jump out of the current round of a CYCLE.
 *
 * Thrown by the GO_TO and FINISH steps and caught by the CYCLE they
 * name. Like `PauseStep` it unwinds the walk, but it is an outcome, not a wait:
 * the executor saves it on the record of every step it passes through, and a
 * replayed walk raises it again from that record instead of moving on — so a
 * resumed execution takes exactly the path the first pass took.
 *
 * ── How a jump meets the control-flow steps between it and its target ──
 *
 * Each control-flow step declares `jumps` (see `JumpBehavior` in base-step.ts),
 * and that one value decides everything:
 *
 *   catch  CYCLE only. The jump stops here — this is the target.
 *   pass   CONDITIONAL, SWITCH, LOOP, and the base-class default. The signal
 *          unwinds straight through; the step never sees it.
 *   block  MAP, PARALLEL. Refused: they run their branches at the same time,
 *          so unwinding one while its siblings continue has no meaning.
 *
 * Which gives, for a GO_TO/FINISH aimed at an enclosing CYCLE:
 *
 *   inside CONDITIONAL / SWITCH   ✓ passes through
 *   inside LOOP                   ✓ passes through — and ABANDONS the loop:
 *                                   the remaining items do not run, and a new
 *                                   round re-enters the LOOP from its first item
 *   inside a nested CYCLE        ✓ passes through — the inner loop's progress
 *                                   is discarded; name the loop you want
 *   inside MAP / PARALLEL         ✗ rejected by the validator, and guarded
 *                                   again at runtime (`blockedJumpError`),
 *                                   because validation only gates activation
 *
 * The reverse nesting is unrestricted: a CYCLE *inside* a MAP or PARALLEL
 * branch is fine, as long as its jumps stay within that branch. These two steps
 * constrain escaping, not containing.
 *
 * `pass` being the default matters: a control-flow step added later is
 * transparent to jumps until it opts in, and to become a target it must both
 * declare `catch` and implement `checkJump` — otherwise a GO_TO could land
 * on it carrying a payload it never validated.
 */
export type JumpKind = 'goto' | 'finish';

export interface JumpSignal {
  readonly kind: JumpKind;
  /** Step id of the CYCLE to jump to. Step ids are unique workflow-wide. */
  readonly target: string;
  /** GO_TO: the next round's input. FINISH: the loop's result. */
  readonly value: Record<string, unknown>;
}

export class BranchSignal extends Error {
  readonly signal: JumpSignal;

  constructor(signal: JumpSignal) {
    super(`${signal.kind === 'goto' ? 'GO_TO' : 'FINISH'} to "${signal.target}"`);
    this.name = 'BranchSignal';
    this.signal = signal;
  }

  static is(err: unknown): err is BranchSignal {
    return (
      err instanceof BranchSignal ||
      (err instanceof Error && err.name === 'BranchSignal')
    );
  }

  /** The jump a step ended with, read back from its saved record; `null` when it ended normally. */
  static fromRecord(data: Record<string, unknown> | null | undefined): BranchSignal | null {
    const saved = data?.['signal'];
    return isJumpSignal(saved) ? new BranchSignal(saved) : null;
  }
}

/**
 * A step that ends by throwing a {@link BranchSignal} (GO_TO, FINISH). The
 * validator checks such a step's `target` through this marker, so it never needs
 * to know the step types.
 */
export interface JumpingStep {
  readonly jumpKind: JumpKind;
}

export function isJumpingStep(step: unknown): step is JumpingStep {
  const kind = (step as { jumpKind?: unknown } | null | undefined)?.jumpKind;
  return kind === 'goto' || kind === 'finish';
}

/**
 * The error PARALLEL and MAP raise when a jump tries to leave one of their
 * branches: the other branches are still running, so there is no single round
 * to end. The validator rejects such a config before it runs.
 */
export function blockedJumpError(signal: JumpSignal, stepType: string): Error {
  const label = signal.kind === 'goto' ? 'GO_TO' : 'FINISH';
  return new Error(
    `${label} to "${signal.target}" can't leave a ${stepType} branch: its branches run at the same time.`,
  );
}

function isJumpSignal(value: unknown): value is JumpSignal {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const payload = v['value'];
  return (
    (v['kind'] === 'goto' || v['kind'] === 'finish') &&
    typeof v['target'] === 'string' &&
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
  );
}
