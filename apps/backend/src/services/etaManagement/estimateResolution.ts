import { VisitSlaMode } from '@xyne/shared';
import type { StageLike, StepEstimate, TransitionLike } from './types';

/**
 * Resolve the working-hour estimate for one route step, from the actual
 * transition configuration that would enter that stage. This is the single
 * source of truth for the SLA-mode decision table - the live stage-entry
 * path (formerly `TicketStageTransitionService.computeStageEta()`, now
 * inlined at its one call site) delegates to this, so the two can never
 * drift. Because that live path already ships and runs unconditionally
 * (independent of this feature's rollout), its existing fallback behavior
 * is preserved byte-for-byte here:
 *
 *   FIXED_HOURS + a positive fixedEtaHours  -> that value
 *   FIXED_HOURS with no/invalid value       -> falls through to Stage.eta (pre-existing
 *                                              self-healing behavior on the live path -
 *                                              NOT treated as a hard config error here)
 *   NONE                                    -> deliberately untracked, 0 hours, NOT an error
 *   STAGE_DEFAULT (or no transition)        -> Stage.eta, when positive
 *   no usable Stage.eta after the above     -> incomplete (missing estimate)
 *   required transition missing entirely    -> config error (incomplete) - only reachable
 *                                              via `requireExplicitTransition`, which only
 *                                              Standard Path route steps set (M5); ordinary
 *                                              linear/DEFAULT transitions never require this.
 */
export function resolveStepEstimate(
  stage: Pick<StageLike, 'id' | 'eta'>,
  transition: TransitionLike | null,
  opts: { requireExplicitTransition: boolean },
): StepEstimate {
  if (transition === null && opts.requireExplicitTransition) {
    return {
      stageId: stage.id,
      hours: 0,
      source: 'STAGE_DEFAULT',
      deadlineTracked: false,
      incomplete: true,
    };
  }

  const slaMode = transition?.visitSlaMode ?? VisitSlaMode.STAGE_DEFAULT;

  switch (slaMode) {
    case VisitSlaMode.FIXED_HOURS: {
      if (transition?.fixedEtaHours && transition.fixedEtaHours > 0) {
        return {
          stageId: stage.id,
          hours: transition.fixedEtaHours,
          source: 'TRANSITION_FIXED',
          deadlineTracked: true,
          incomplete: false,
        };
      }
      // Fixed-hours mode selected but no usable value - fall through to stage default,
      // matching the pre-existing live-path behavior exactly (see module doc comment).
      if (stage.eta && stage.eta > 0) {
        return {
          stageId: stage.id,
          hours: stage.eta,
          source: 'STAGE_DEFAULT',
          deadlineTracked: true,
          incomplete: false,
        };
      }
      return {
        stageId: stage.id,
        hours: 0,
        source: 'TRANSITION_FIXED',
        deadlineTracked: false,
        incomplete: true,
      };
    }

    case VisitSlaMode.NONE:
      // Deliberately no SLA - contributes 0 tracked hours, not treated as missing/incomplete.
      return {
        stageId: stage.id,
        hours: 0,
        source: 'STAGE_DEFAULT',
        deadlineTracked: false,
        incomplete: false,
      };

    case VisitSlaMode.STAGE_DEFAULT:
    default: {
      if (stage.eta && stage.eta > 0) {
        return {
          stageId: stage.id,
          hours: stage.eta,
          source: 'STAGE_DEFAULT',
          deadlineTracked: true,
          incomplete: false,
        };
      }
      return {
        stageId: stage.id,
        hours: 0,
        source: 'STAGE_DEFAULT',
        deadlineTracked: false,
        incomplete: true,
      };
    }
  }
}
