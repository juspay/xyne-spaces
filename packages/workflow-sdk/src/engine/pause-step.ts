import type { PausePathSegment } from '../types/pause-path.js';
import type { GateCategory } from '../types/known-types.js';

/** What a step says when it parks. */
export interface PauseOptions {
  /**
   * Who the run is waiting on. Required: a gate with no category is one the
   * approvals inbox has to guess about.
   */
  readonly category: GateCategory;
  /** The external side's own id for this work, when it has one. */
  readonly externalRef?: string;
  /** Merged into the step's record, and read back by `onResume`. */
  readonly statePatch?: Record<string, unknown>;
  /**
   * `review` only for the engine's own review gate, which is a pause about a
   * step's output rather than a pause the step asked for. Drives `pauseType`.
   */
  readonly origin?: 'step' | 'review';
}

/**
 * Thrown by `ctx.pause()` to suspend workflow execution.
 *
 * The executor catches this, persists the context + state, and sets the
 * execution status to EXTERNAL_WAIT. When the external event arrives, the
 * executor resumes from the paused step by calling `onResume()`.
 */
export class PauseStep extends Error {
  readonly category: GateCategory;
  readonly externalRef: string | undefined;
  readonly statePatch: Record<string, unknown> | undefined;
  readonly origin: 'step' | 'review';

  /** @internal Used by executor to track nested pause position in branches. */
  _pausePath: PausePathSegment[] = [];

  constructor(reason: string, options: PauseOptions) {
    super(`Step paused: ${reason}`);
    // Loud rather than defaulted: a gate nobody classified is a bug in the step,
    // and failing the run says so. Guessing would file it in somebody's inbox.
    if (!options?.category) {
      throw new Error(
        `Cannot pause at "${reason}" without a category: say who the run is waiting on (GateCategory)`,
      );
    }
    this.name = 'PauseStep';
    this.category = options.category;
    this.externalRef = options.externalRef;
    this.statePatch = options.statePatch;
    this.origin = options.origin ?? 'step';
  }

  static is(err: unknown): err is PauseStep {
    return (
      err instanceof PauseStep ||
      (err instanceof Error && err.name === 'PauseStep')
    );
  }
}
