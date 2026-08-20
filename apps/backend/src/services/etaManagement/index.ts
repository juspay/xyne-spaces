import type {
  BoardEtaManagement,
  EstimateSource,
  EtaChangeTrigger,
  TicketEtaManagement,
} from '@xyne/shared';
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
export { loadZeroEtaContext } from './zeroContext';
export type { LoadedZeroEtaContext } from './zeroContext';
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
  };

  return { forecast, etaDecision, planningRisk, ticketEtaManagementPatch };
}
