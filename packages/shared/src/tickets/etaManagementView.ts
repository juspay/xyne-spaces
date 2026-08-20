import type { BoardEtaManagement, TicketEtaManagement } from '../validation/etaManagementSchema';

/**
 * ETA display state for a single ticket, derived on the client from
 * already-synced `Ticket.metadata`/`Board.metadata`. A single pure function
 * so the severity/badge decision can never drift between wherever it's
 * computed.
 *
 * Deliberately carries no permission signal: the backend is the only
 * authority on who may change or acknowledge ETA state, and it enforces that
 * on the mutation itself.
 */

export type EtaDisplaySeverity = 'TICKET_OVERDUE' | 'STAGE_OVERDUE' | 'PLANNING_RISK' | 'NONE';

export interface DeriveEtaManagementViewInput {
  ticketEtaManagement: TicketEtaManagement;
  boardEtaManagement: BoardEtaManagement;
  /** `Ticket.eta`, epoch ms. */
  ticketEta: number | null;
  /** `Ticket.statusV2`. */
  ticketStatus: string;
  /** Caller-supplied "now" (epoch ms) so the computation is deterministic/testable. */
  now: number;
}

export interface EtaManagementView {
  autoEnabled: boolean;
  forecastStatus: TicketEtaManagement['forecastStatus'];
  forecastIncompleteReason: string | null;
  planningRiskState: TicketEtaManagement['planningRisk']['state'];
  /** Risk/overdue state stays visible while paused, but labeled "(paused)" rather than hidden. */
  isPaused: boolean;
  /** Most severe condition, for the primary badge: ticket-overdue > stage-overdue > planning-risk. */
  severity: EtaDisplaySeverity;
  stageDeadline: number | null;
  ticketDue: number | null;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED']);
const PAUSED_STATUS = 'PAUSED';

export function deriveEtaManagementView(input: DeriveEtaManagementViewInput): EtaManagementView {
  const { ticketEtaManagement, boardEtaManagement, ticketEta, ticketStatus, now } = input;
  const { planningRisk, activeVisit } = ticketEtaManagement;

  const isTerminal = TERMINAL_STATUSES.has(ticketStatus);
  const isPaused = ticketStatus === PAUSED_STATUS;

  const stageDeadline = activeVisit.deadlineTracked ? planningRisk.stageEta : null;
  const isStageOverdue = !isTerminal && stageDeadline !== null && now > stageDeadline;
  const isTicketOverdue = !isTerminal && ticketEta !== null && now > ticketEta;
  const hasPlanningRisk = !isTerminal && (planningRisk.state === 'ACTIVE' || planningRisk.state === 'ACKNOWLEDGED');

  let severity: EtaDisplaySeverity = 'NONE';
  if (isTicketOverdue) severity = 'TICKET_OVERDUE';
  else if (isStageOverdue) severity = 'STAGE_OVERDUE';
  else if (hasPlanningRisk) severity = 'PLANNING_RISK';

  return {
    autoEnabled: boardEtaManagement.autoRecomputeEnabled,
    forecastStatus: ticketEtaManagement.forecastStatus,
    forecastIncompleteReason: ticketEtaManagement.forecastIncompleteReason,
    planningRiskState: planningRisk.state,
    isPaused,
    severity,
    stageDeadline,
    ticketDue: ticketEta,
  };
}
