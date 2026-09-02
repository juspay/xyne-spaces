import {
  ActivityType,
  parseTicketEtaManagement,
  type EtaActivityOutbox,
  type EtaAutoRecomputedActivityValue,
  type EtaRiskAcknowledgedActivityValue,
  type EtaChangeTrigger,
  type EtaRiskDetectedActivityValue,
  type EtaRiskReopenedActivityValue,
  type EtaRiskResolvedActivityValue,
} from '@xyne/shared';
import type { EvaluateEtaResult } from './index';

/**
 * Stages built intents into the metadata outbox that
 * `TicketsSideEffectHandler` drains post-commit. Pass the result straight into
 * `mergeTicketEtaManagement` alongside the evaluation's own patch, so the rows
 * a mutation intends and the state it writes commit together or not at all.
 *
 * Returns null for an empty intent list, which also clears any outbox left by
 * a previous evaluation.
 */
export function stageEtaActivityOutbox(
  intents: ReadonlyArray<EtaActivityIntent>,
  at: number,
): EtaActivityOutbox | null {
  if (intents.length === 0) return null;
  return {
    at,
    entries: intents.map(intent => ({
      activityType: intent.activityType,
      value: intent.value,
      actorId: intent.actorId ?? null,
    })),
  };
}

/**
 * Post-commit counterpart to {@link stageEtaActivityOutbox}: returns the
 * intents a `tickets.update` side effect should write, or an empty list when
 * this job's outbox was already drained (same `at`) or empty.
 */
export function drainEtaActivityOutbox(input: {
  previousMetadata: unknown;
  currentMetadata: unknown;
}): EtaActivityIntent[] {
  const prev = parseTicketEtaManagement(input.previousMetadata).pendingActivities;
  const next = parseTicketEtaManagement(input.currentMetadata).pendingActivities;

  if (!next || next.entries.length === 0) return [];
  if (prev && prev.at === next.at) return [];

  return next.entries.map(entry => ({
    activityType: entry.activityType as ActivityType,
    value: entry.value,
    actorId: entry.actorId,
  }));
}

/** Timestamp the drained rows should carry - the originating mutation's own. */
export function drainedOutboxTimestamp(currentMetadata: unknown): number | null {
  return parseTicketEtaManagement(currentMetadata).pendingActivities?.at ?? null;
}

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
  /**
   * Attributing user for user-authored rows (ETA_MANUALLY_UPDATED,
   * ETA_RISK_ACKNOWLEDGED). Omitted/null for automatic rows, which are
   * attributed to the workspace ticket bot.
   */
  actorId?: string | null;
  /**
   * Body of the SYSTEM message that should accompany this row in the ticket's
   * conversation thread. Filled in by the side-effect handler via
   * {@link etaSystemMessageContent} once it has resolved the actor's display
   * name; left unset for rows that get no thread message.
   */
  systemMessageContent?: string;
}

/**
 * Body of the conversation-thread message for an ETA row, or null when that
 * activity type gets a timeline row only.
 *
 * Kept out of the outbox itself: the metadata subtree stores the facts, and
 * the rendered sentence (which needs a display-name lookup) is produced
 * post-commit, so mutators don't pay for that query on the mutation path.
 */
export function etaSystemMessageContent(
  intent: EtaActivityIntent,
  actorName: string,
): string | null {
  switch (intent.activityType) {
    case ActivityType.ETA_RISK_ACKNOWLEDGED: {
      const reason = (intent.value as EtaRiskAcknowledgedActivityValue | undefined)?.reason ?? '';
      return `${actorName} acknowledged the planning-risk warning: ${reason}`;
    }
    default:
      return null;
  }
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

  return intents;
}
