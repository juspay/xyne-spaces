/**
 * PausePath — a tree-structured position for pause/resume.
 *
 * Replaces the flat `currentStepIndex: number` with a full tree address
 * that supports pausing inside nested branches (CONDITIONAL, SWITCH, LOOP).
 *
 * Example: step 2 is CONDITIONAL, paused inside `if_true` branch at sub-step 1:
 * ```
 * [
 *   { stepIndex: 2 },
 *   { stepIndex: 1, branch: { stepId: 'cond_1', branchKey: 'if_true' } }
 * ]
 * ```
 */
export interface PausePathSegment {
  stepIndex: number;
  branch?: {
    stepId: string;
    branchKey: string;
  };
}

export type PausePath = PausePathSegment[];
