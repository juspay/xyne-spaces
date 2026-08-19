import {
  ActivityType,
  type EtaAutoRecomputedActivityValue,
  type EtaChangeTrigger,
  type EtaForecastIncompleteActivityValue,
  type EtaRiskDetectedActivityValue,
  type EtaRiskReopenedActivityValue,
  type EtaRiskResolvedActivityValue,
  type EtaDeviationReturnedActivityValue,
} from '@xyne/shared';
import type { EvaluateEtaResult } from './index';

/**
 * Translates an `evaluateEta` result into the list of TicketActivity rows
 * that should be recorded for it, using the typed value contracts from
 * packages/shared/src/tickets/etaActivityValues.ts. Storage-agnostic - the
 * Prisma call sites hand these to `recordTicketTimelineEvent`, Zero
 * mutators write them via `tx.mutate.ticket_activities.insert`, both using
 * the exact same shapes so the two write paths can never drift.
 */
export interface EtaActivityIntent {
  activityType: ActivityType;
  /** One of the typed Eta*ActivityValue interfaces - precise type already enforced at the push site below. */
  value: unknown;
}

export interface BuildActivityIntentsContext {
  currentStageId: string;
  oldEta: number | null;
  boardConfigVersion: number;
  trigger: EtaChangeTrigger;
  systemReason: string;
  /** The risk fingerprint that was persisted before this evaluation ran (for ETA_RISK_REOPENED). */
  previousRiskFingerprint: string | null;
}

/**
 * Activity intents for a risk-state transition alone, with no forecast or
 * due-date change involved - the hourly reconciliation worker's case, since
 * it deliberately never recomputes forecasts or extends dates. Avoids making
 * that caller fabricate a whole `EvaluateEtaResult` just to reach the
 * risk-transition branch of `buildEtaActivityIntents`.
 */
export function buildRiskTransitionActivityIntents(
  planningRisk: EvaluateEtaResult['planningRisk'],
  ctx: BuildActivityIntentsContext,
): EtaActivityIntent[] {
  return buildEtaActivityIntents(
    {
      forecast: {
        status: 'NOT_APPLICABLE',
        incompleteReason: null,
        incompleteStageIds: [],
        forecastEta: null,
      },
      etaDecision: { newEta: null, changed: false },
      planningRisk,
      ticketEtaManagementPatch: {},
      forecastNewlyIncomplete: false,
      deviationReturned: null,
    },
    ctx,
  );
}

export function buildEtaActivityIntents(
  result: EvaluateEtaResult,
  ctx: BuildActivityIntentsContext,
): EtaActivityIntent[] {
  const intents: EtaActivityIntent[] = [];

  if (result.etaDecision.changed && result.etaDecision.newEta && result.forecast.forecastEta) {
    const value: EtaAutoRecomputedActivityValue = {
      trigger: ctx.trigger,
      oldEta: ctx.oldEta,
      forecastEta: result.forecast.forecastEta.getTime(),
      finalEta: result.etaDecision.newEta.getTime(),
      stageVisitId: result.ticketEtaManagementPatch.activeVisit?.stageVisitId ?? null,
      boardConfigVersion: ctx.boardConfigVersion,
      standardPathUsed: false,
      systemReason: ctx.systemReason,
    };
    intents.push({ activityType: ActivityType.ETA_AUTO_RECOMPUTED, value });
  }

  const risk = result.planningRisk.nextState;
  switch (result.planningRisk.transitionKind) {
    case 'DETECTED': {
      const value: EtaRiskDetectedActivityValue = {
        fingerprint: risk.fingerprint ?? '',
        stageEta: risk.stageEta ?? 0,
        ticketEta: risk.ticketEta ?? 0,
        stageId: ctx.currentStageId,
        stageVisitId: risk.stageVisitId ?? '',
        boardConfigVersion: risk.boardConfigVersion ?? ctx.boardConfigVersion,
      };
      intents.push({ activityType: ActivityType.ETA_RISK_DETECTED, value });
      break;
    }
    case 'REOPENED': {
      const value: EtaRiskReopenedActivityValue = {
        previousFingerprint: ctx.previousRiskFingerprint,
        newFingerprint: risk.fingerprint ?? '',
        changedInputs: result.planningRisk.changedInputs,
      };
      intents.push({ activityType: ActivityType.ETA_RISK_REOPENED, value });
      break;
    }
    case 'RESOLVED': {
      const value: EtaRiskResolvedActivityValue = {
        fingerprint: ctx.previousRiskFingerprint ?? '',
        cause: result.planningRisk.changedInputs.includes('ticketStatus')
          ? 'TERMINAL_STATUS'
          : 'CONDITION_NO_LONGER_TRUE',
      };
      intents.push({ activityType: ActivityType.ETA_RISK_RESOLVED, value });
      break;
    }
    default:
      break;
  }

  if (result.forecastNewlyIncomplete) {
    const value: EtaForecastIncompleteActivityValue = {
      reason: result.forecast.incompleteReason ?? 'UNKNOWN',
      affectedStageIds: result.forecast.incompleteStageIds,
      boardConfigVersion: ctx.boardConfigVersion,
      forecastStatus: 'INCOMPLETE',
    };
    intents.push({ activityType: ActivityType.ETA_FORECAST_INCOMPLETE, value });
  }

  if (result.deviationReturned) {
    const value: EtaDeviationReturnedActivityValue = {
      offPathStageIds: result.deviationReturned.offPathStageIds,
      offPathWorkingDurationMs: result.deviationReturned.offPathWorkingDurationMs,
      returnStageId: result.deviationReturned.returnStageId,
      forecastEta: result.forecast.forecastEta ? result.forecast.forecastEta.getTime() : null,
      oldEta: ctx.oldEta,
      finalEta: result.etaDecision.newEta ? result.etaDecision.newEta.getTime() : null,
      etaChanged: result.etaDecision.changed,
    };
    intents.push({ activityType: ActivityType.ETA_DEVIATION_RETURNED, value });
  }

  return intents;
}
