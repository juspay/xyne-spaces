import { calculateETADeadline } from '@/utils/etaCalculation';
import { resolveStepEstimate } from './estimateResolution';
import type { ForecastResult, RouteResolution, StageLike } from './types';

export interface BuildForecastInput {
  route: RouteResolution;
  /**
   * The active stage's tracked deadline, already reenter-mode-adjusted (i.e.
   * the real `TicketStageEta.stageEta` value after RESET/CONTINUE has been
   * applied by the caller). Null when the current stage has no genuinely
   * tracked deadline (no-SLA placeholder, or no active visit at all).
   */
  activeStageDeadline: Date | null;
  now: Date;
  stagesById: ReadonlyMap<string, Pick<StageLike, 'id' | 'eta'>>;
}

/**
 * Build a forecast from the active stage deadline plus all resolvable
 * remaining route estimates. Never treats a missing estimate as zero - any
 * incomplete step marks the whole forecast INCOMPLETE with no `forecastEta`.
 */
export function buildForecast(input: BuildForecastInput): ForecastResult {
  const { route, activeStageDeadline, now, stagesById } = input;

  if (route.kind === 'NOT_APPLICABLE') {
    return {
      status: 'NOT_APPLICABLE',
      incompleteReason: null,
      incompleteStageIds: [],
      forecastEta: null,
      standardPathUsed: false,
    };
  }

  if (route.kind === 'DEVIATED') {
    return {
      status: 'NOT_APPLICABLE',
      incompleteReason: 'TICKET_OFF_STANDARD_PATH',
      incompleteStageIds: [route.offPathStageId],
      forecastEta: null,
      // A deviation is only reachable on a board that has a Standard Path configured.
      standardPathUsed: true,
    };
  }

  if (activeStageDeadline === null) {
    return {
      status: 'INCOMPLETE',
      incompleteReason: 'NO_TRACKED_ACTIVE_DEADLINE',
      incompleteStageIds: [],
      forecastEta: null,
      standardPathUsed: route.standardPathUsed,
    };
  }

  let totalHours = 0;
  const incompleteStageIds: string[] = [];

  for (const step of route.steps) {
    const stage = stagesById.get(step.stageId);
    if (!stage) {
      incompleteStageIds.push(step.stageId);
      continue;
    }
    const estimate = resolveStepEstimate(stage, step.transition, {
      requireExplicitTransition: step.requireExplicitTransition,
    });
    if (estimate.incomplete) {
      incompleteStageIds.push(step.stageId);
      continue;
    }
    totalHours += estimate.hours;
  }

  if (incompleteStageIds.length > 0) {
    return {
      status: 'INCOMPLETE',
      incompleteReason: 'MISSING_STAGE_ESTIMATE',
      incompleteStageIds,
      forecastEta: null,
      standardPathUsed: route.standardPathUsed,
    };
  }

  // Anchor at the later of the active deadline and now: an already-expired deadline
  // (expired CONTINUE, or a RESET/fresh deadline that's since passed) must not produce a
  // forecast in the past; a still-future deadline is kept as-is so existing buffer absorbs
  // some or all of any detour.
  const basis = activeStageDeadline.getTime() > now.getTime() ? activeStageDeadline : now;
  const forecastEta = calculateETADeadline(basis, totalHours);

  return {
    status: 'COMPLETE',
    incompleteReason: null,
    incompleteStageIds: [],
    forecastEta,
    standardPathUsed: route.standardPathUsed,
  };
}
