import type {
  BoardEtaManagement,
  EstimateSource,
  EtaChangeTrigger,
  TicketEtaManagement,
  TicketEtaManagementDeviation,
} from '@xyne/shared';
import { calculateWorkingDurationMs } from '@/utils/etaCalculation';
import { resolveForecastRoute } from './routeResolution';
import { buildForecast } from './forecastBuilder';
import { decideEtaUpdate } from './extendOnly';
import { evaluatePlanningRisk } from './riskEvaluation';
import type {
  EtaUpdateDecision,
  ForecastResult,
  PlanningRiskDecision,
  StageLike,
  TransitionLike,
} from './types';

export * from './types';
export { resolveForecastRoute } from './routeResolution';
export { resolveStepEstimate } from './estimateResolution';
export { buildForecast } from './forecastBuilder';
export { decideEtaUpdate } from './extendOnly';
export { evaluatePlanningRisk } from './riskEvaluation';
export { canUserModifyTicketControl } from './etaPermissions';
export { isEtaManagementKillSwitchActive } from './featureFlag';
export { buildEtaActivityIntents, buildRiskTransitionActivityIntents } from './activityIntents';
export { writeEtaActivitiesPrisma, writeEtaActivitiesZero } from './etaActivityWriters';
export type { EtaActivityWriteContext } from './etaActivityWriters';
export type { EtaActivityIntent, BuildActivityIntentsContext } from './activityIntents';
export { loadBoardEtaContext, isTerminalStatus } from './prismaContext';
export type { LoadedBoardEtaContext } from './prismaContext';
export { msToDate, dateToMs } from './dateAdapter';
export { resolveAwarenessRecipients, resolveActionRecipients } from './etaRecipients';
export {
  dispatchEtaNotifications,
  etaSignalsFromResult,
  etaSignalsFromMetadataDiff,
} from './etaNotificationDispatch';
export type { DispatchEtaNotificationsContext, EtaNotificationSignals } from './etaNotificationDispatch';

export interface ActiveVisitContext {
  stageVisitId: string | null;
  transitionId: string | null;
  /** The visit's tracked deadline, already reenter-mode-adjusted (RESET/CONTINUE already applied). Ignored unless `deadlineTracked` is true. */
  deadline: Date | null;
  /** False for the no-SLA placeholder (stageEta === stageEnteredAt) or when there's no active visit. */
  deadlineTracked: boolean;
  estimateSource: EstimateSource;
  estimateHours: number | null;
}

export interface EvaluateEtaInput {
  ticketId: string;
  ticketStatus: string;
  isTerminal: boolean;
  currentTicketEta: Date | null;
  currentTicketEtaManagement: TicketEtaManagement;
  boardType: string;
  boardEtaManagement: BoardEtaManagement;
  currentStageId: string;
  stages: ReadonlyArray<Pick<StageLike, 'id' | 'sequenceNumber' | 'eta'>>;
  transitions: ReadonlyArray<TransitionLike>;
  activeVisit: ActiveVisitContext;
  trigger: EtaChangeTrigger;
  now: Date;
  globalKillSwitchEnabled: boolean;
}

export interface EvaluateEtaResult {
  forecast: ForecastResult;
  etaDecision: EtaUpdateDecision;
  planningRisk: PlanningRiskDecision;
  /** Ready to pass as the `patch` argument to `mergeTicketEtaManagement`. */
  ticketEtaManagementPatch: Partial<Omit<TicketEtaManagement, 'activeVisit' | 'planningRisk'>> & {
    activeVisit?: Partial<TicketEtaManagement['activeVisit']>;
    planningRisk?: Partial<TicketEtaManagement['planningRisk']>;
  };
  /**
   * True only the first time this evaluation observes the current
   * incompleteness (vs. already being incomplete for the same set of
   * stages) - governs ETA_FORECAST_INCOMPLETE activity dedup per PRD §10.5.
   */
  forecastNewlyIncomplete: boolean;
  /** Set only on the evaluation where the ticket returns to the Standard Path from a deviation (PRD §6.6). */
  deviationReturned: {
    offPathStageIds: string[];
    offPathWorkingDurationMs: number;
    returnStageId: string;
  } | null;
}

function stageIdSetsEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * The single evaluation entry point every mutation path calls identically:
 * resolve the route, build a forecast, apply the extend-only decision,
 * evaluate planning risk against the final due date, and produce a
 * ready-to-merge `Ticket.metadata.etaManagement` patch. Pure - no Prisma or
 * Zero access. Callers load `EvaluateEtaInput` from their own storage layer
 * and apply the returned `etaDecision`/`ticketEtaManagementPatch`
 * themselves, inside the same transaction as the rest of the mutation.
 */
export function evaluateEta(input: EvaluateEtaInput): EvaluateEtaResult {
  const {
    ticketId,
    ticketStatus,
    isTerminal,
    currentTicketEta,
    currentTicketEtaManagement,
    boardType,
    boardEtaManagement,
    currentStageId,
    stages,
    transitions,
    activeVisit,
    now,
    globalKillSwitchEnabled,
  } = input;

  if (globalKillSwitchEnabled) {
    return {
      forecast: { status: 'NOT_APPLICABLE', incompleteReason: null, incompleteStageIds: [], forecastEta: null },
      etaDecision: { newEta: currentTicketEta, changed: false },
      planningRisk: {
        nextState: currentTicketEtaManagement.planningRisk,
        transitionKind: 'UNCHANGED',
        changedInputs: [],
      },
      ticketEtaManagementPatch: {},
      forecastNewlyIncomplete: false,
      deviationReturned: null,
    };
  }

  const route = resolveForecastRoute({
    boardType,
    currentStageId,
    stages,
    transitions,
    standardPathStageIds: boardEtaManagement.standardPathStageIds,
  });

  const stagesById = new Map(stages.map((s) => [s.id, s]));
  const forecast = buildForecast({
    route,
    activeStageDeadline: activeVisit.deadlineTracked ? activeVisit.deadline : null,
    now,
    stagesById,
  });

  // Automatic extension only applies when the board has opted in; detection (below)
  // always runs regardless, per the Phase 1 (detect-only) / Phase 2 (auto-extend) split.
  const etaDecision = boardEtaManagement.autoRecomputeEnabled
    ? decideEtaUpdate(currentTicketEta, forecast)
    : { newEta: currentTicketEta, changed: false };

  const planningRisk = evaluatePlanningRisk({
    ticketId,
    activeStageVisitId: activeVisit.stageVisitId,
    stageDeadline: activeVisit.deadlineTracked ? activeVisit.deadline : null,
    deadlineTracked: activeVisit.deadlineTracked,
    ticketDue: etaDecision.newEta,
    ticketStatus,
    boardConfigVersion: boardEtaManagement.configVersion,
    now,
    currentRisk: currentTicketEtaManagement.planningRisk,
    isTerminal,
  });

  const forecastNewlyIncomplete =
    forecast.status === 'INCOMPLETE' &&
    (currentTicketEtaManagement.forecastStatus !== 'INCOMPLETE' ||
      !stageIdSetsEqual(currentTicketEtaManagement.forecastIncompleteStageIds, forecast.incompleteStageIds));

  // Standard Path deviation tracking (NON_LINEAR only - route.kind is only ever 'DEVIATED'
  // when a Standard Path is configured and the current stage isn't on it). Auto-extension is
  // already inert while deviated (buildForecast marks it NOT_APPLICABLE, so decideEtaUpdate
  // is a no-op above); this only tracks state for the eventual return.
  const wasDeviated = currentTicketEtaManagement.deviation !== null;
  const isDeviatedNow = route.kind === 'DEVIATED';
  let deviationPatch: TicketEtaManagementDeviation | null = currentTicketEtaManagement.deviation;
  let deviationReturned: EvaluateEtaResult['deviationReturned'] = null;

  if (isDeviatedNow) {
    const existing = currentTicketEtaManagement.deviation;
    deviationPatch = {
      startedAt: existing?.startedAt ?? now.getTime(),
      offPathStageIds: existing?.offPathStageIds.includes(currentStageId)
        ? existing.offPathStageIds
        : [...(existing?.offPathStageIds ?? []), currentStageId],
    };
  } else if (wasDeviated) {
    const existing = currentTicketEtaManagement.deviation!;
    deviationReturned = {
      offPathStageIds: existing.offPathStageIds,
      offPathWorkingDurationMs: calculateWorkingDurationMs(new Date(existing.startedAt), now),
      returnStageId: currentStageId,
    };
    deviationPatch = null;
  }

  const ticketEtaManagementPatch: EvaluateEtaResult['ticketEtaManagementPatch'] = {
    lastEvaluatedAt: now.getTime(),
    lastBoardConfigVersion: boardEtaManagement.configVersion,
    forecastStatus: forecast.status,
    forecastIncompleteReason: forecast.incompleteReason,
    forecastIncompleteStageIds: forecast.incompleteStageIds,
    activeVisit: {
      stageVisitId: activeVisit.stageVisitId,
      transitionId: activeVisit.transitionId,
      deadlineTracked: activeVisit.deadlineTracked,
      estimateSource: activeVisit.estimateSource,
      estimateHours: activeVisit.estimateHours,
    },
    planningRisk: planningRisk.nextState,
    deviation: deviationPatch,
  };

  return { forecast, etaDecision, planningRisk, ticketEtaManagementPatch, forecastNewlyIncomplete, deviationReturned };
}
