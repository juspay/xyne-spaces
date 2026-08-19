import type { BoardEtaManagement, TicketEtaManagement } from '../validation/etaManagementSchema';

/**
 * Server-derived (or, in this Zero-synced app, identically-derived on the
 * client from already-synced `Ticket.metadata`/`Board.metadata`) ETA
 * display state for a single ticket. A single pure function so the
 * severity/badge decision can never drift between wherever it's computed
 * callers must pass an already-resolved
 * `viewerHasControlPermission` (via `canUserModifyTicketControl`) rather
 * than letting a consumer re-derive it from `ticketControlRoleIds` itself.
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
  /** Result of `canUserModifyTicketControl` for this viewer/ticket/board - this function does not perform that lookup itself. */
  viewerHasControlPermission: boolean;
}

export interface EtaManagementView {
  autoEnabled: boolean;
  forecastStatus: TicketEtaManagement['forecastStatus'];
  forecastIncompleteReason: string | null;
  planningRiskState: TicketEtaManagement['planningRisk']['state'];
  isStageOverdue: boolean;
  isTicketOverdue: boolean;
  /** Ticket is currently paused - risk/overdue state above stays visible but should be labeled "(paused)" per PRD §6.9, not hidden. */
  isPaused: boolean;
  /** Most severe condition, for the primary badge: ticket-overdue > stage-overdue > planning-risk. */
  severity: EtaDisplaySeverity;
  stageDeadline: number | null;
  ticketDue: number | null;
  viewerCanAct: boolean;
  viewerCanAcknowledge: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED']);
const PAUSED_STATUS = 'PAUSED';

export function deriveEtaManagementView(input: DeriveEtaManagementViewInput): EtaManagementView {
  const { ticketEtaManagement, boardEtaManagement, ticketEta, ticketStatus, now, viewerHasControlPermission } =
    input;
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
    isStageOverdue,
    isTicketOverdue,
    isPaused,
    severity,
    stageDeadline,
    ticketDue: ticketEta,
    viewerCanAct: viewerHasControlPermission,
    viewerCanAcknowledge: viewerHasControlPermission && planningRisk.state === 'ACTIVE',
  };
}
