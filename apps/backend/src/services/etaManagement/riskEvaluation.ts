import { computeRiskFingerprint, type TicketEtaManagementPlanningRisk } from '@xyne/shared';
import type { PlanningRiskDecision } from './types';

export interface EvaluatePlanningRiskInput {
  ticketId: string;
  /** Active TicketStageEta.id, or null when there's no active visit. */
  activeStageVisitId: string | null;
  stageDeadline: Date | null;
  /** False for the no-SLA placeholder (stageEta === stageEnteredAt) - never compared as a real deadline. */
  deadlineTracked: boolean;
  ticketDue: Date | null;
  ticketStatus: string;
  boardConfigVersion: number;
  now: Date;
  currentRisk: TicketEtaManagementPlanningRisk;
  /** Ticket is in a terminal (Completed/Cancelled) status. */
  isTerminal: boolean;
}

/**
 * Three-state planning-risk evaluation, comparing new inputs against the
 * currently persisted risk state to decide whether nothing changed, risk
 * was newly detected, an acknowledged/active risk was reopened by changed
 * inputs, or an active/acknowledged risk should now resolve. Planning risk
 * is deliberately distinct from stage-overdue: `now <= stageDeadline` is
 * part of the condition, so a breached deadline stops being a *planning*
 * risk (it becomes a stage-overdue condition, handled elsewhere).
 */
export function evaluatePlanningRisk(input: EvaluatePlanningRiskInput): PlanningRiskDecision {
  const {
    ticketId,
    activeStageVisitId,
    stageDeadline,
    deadlineTracked,
    ticketDue,
    ticketStatus,
    boardConfigVersion,
    now,
    currentRisk,
    isTerminal,
  } = input;

  if (isTerminal) {
    return resolveIfActive(currentRisk, 'ticketStatus');
  }

  const hasComparableData =
    deadlineTracked && stageDeadline !== null && ticketDue !== null && activeStageVisitId !== null;

  if (!hasComparableData) {
    return resolveIfActive(currentRisk, 'comparableData');
  }

  const conditionTrue =
    stageDeadline!.getTime() > ticketDue!.getTime() && now.getTime() <= stageDeadline!.getTime();

  const fingerprint = computeRiskFingerprint({
    ticketId,
    activeStageVisitId: activeStageVisitId!,
    stageEta: stageDeadline!.getTime(),
    ticketEta: ticketDue!.getTime(),
    ticketStatus,
    boardConfigVersion,
  });

  if (!conditionTrue) {
    return resolveIfActive(currentRisk, 'condition');
  }

  if (currentRisk.state === 'NONE' || currentRisk.state === 'RESOLVED') {
    return {
      nextState: {
        state: 'ACTIVE',
        fingerprint,
        detectedAt: now.getTime(),
        stageVisitId: activeStageVisitId,
        stageEta: stageDeadline!.getTime(),
        ticketEta: ticketDue!.getTime(),
        boardConfigVersion,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgmentReason: null,
      },
      transitionKind: 'DETECTED',
      changedInputs: [],
    };
  }

  // state is ACTIVE or ACKNOWLEDGED.
  if (currentRisk.fingerprint === fingerprint) {
    return { nextState: currentRisk, transitionKind: 'UNCHANGED', changedInputs: [] };
  }

  const changedInputs = diffFingerprintInputs(currentRisk, {
    stageDeadline,
    ticketDue,
    boardConfigVersion,
    activeStageVisitId,
  });

  return {
    nextState: {
      state: 'ACTIVE',
      fingerprint,
      detectedAt: now.getTime(),
      stageVisitId: activeStageVisitId,
      stageEta: stageDeadline!.getTime(),
      ticketEta: ticketDue!.getTime(),
      boardConfigVersion,
      acknowledgedAt: null,
      acknowledgedBy: null,
      acknowledgmentReason: null,
    },
    transitionKind: 'REOPENED',
    changedInputs,
  };
}

function resolveIfActive(
  currentRisk: TicketEtaManagementPlanningRisk,
  changedInput: string,
): PlanningRiskDecision {
  if (currentRisk.state === 'ACTIVE' || currentRisk.state === 'ACKNOWLEDGED') {
    return {
      nextState: { ...currentRisk, state: 'RESOLVED' },
      transitionKind: 'RESOLVED',
      changedInputs: [changedInput],
    };
  }
  return { nextState: currentRisk, transitionKind: 'UNCHANGED', changedInputs: [] };
}

function diffFingerprintInputs(
  prev: TicketEtaManagementPlanningRisk,
  next: {
    stageDeadline: Date | null;
    ticketDue: Date | null;
    boardConfigVersion: number;
    activeStageVisitId: string | null;
  },
): string[] {
  const changed: string[] = [];
  if (prev.stageEta !== (next.stageDeadline?.getTime() ?? null)) changed.push('stageEta');
  if (prev.ticketEta !== (next.ticketDue?.getTime() ?? null)) changed.push('ticketEta');
  if (prev.boardConfigVersion !== next.boardConfigVersion) changed.push('boardConfigVersion');
  if (prev.stageVisitId !== next.activeStageVisitId) changed.push('stageVisitId');
  return changed;
}
