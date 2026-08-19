import { parseTicketEtaManagement, type TicketEtaManagement } from '@xyne/shared';
import { notificationService } from '@/services/notificationService';
import { resolveAwarenessRecipients, resolveActionRecipients } from './etaRecipients';
import type { EvaluateEtaResult } from './index';

export interface DispatchEtaNotificationsContext {
  ticketId: string;
  createdBy: string;
  assignedTo: string | null;
  ticketUserGroupId: string | null;
  boardId: string;
  /** Real acting user id for a manual change, or the system/ticket-bot actor id for an automatic one - excluded from its own notification either way. */
  actorId: string;
}

/**
 * The minimal "what happened" input the notification dispatch needs, kept
 * deliberately separate from `EvaluateEtaResult` so it can be produced two
 * ways:
 *
 *  - from the in-transaction evaluation result (Prisma paths, which already
 *    own their post-commit side effects) via `etaSignalsFromResult`, and
 *  - from a post-commit `Ticket.metadata` diff (the Zero side-effect
 *    handler, which never sees the in-transaction result) via
 *    `etaSignalsFromMetadataDiff`.
 *
 * Both feed the same `dispatchEtaNotifications`, so the two paths can never
 * notify differently for the same underlying change.
 */
export interface EtaNotificationSignals {
  /** Non-null only when a risk was newly detected or reopened - the two cases that notify. */
  riskAlert: { stageDeadline: number; ticketDue: number } | null;
  /** Set when the ticket due date actually moved. */
  newEta: Date | null;
}

export function etaSignalsFromResult(
  etaResult: Pick<EvaluateEtaResult, 'etaDecision' | 'planningRisk'>,
): EtaNotificationSignals {
  const { planningRisk, etaDecision } = etaResult;
  const isAlert = planningRisk.transitionKind === 'DETECTED' || planningRisk.transitionKind === 'REOPENED';
  const risk = planningRisk.nextState;
  return {
    riskAlert:
      isAlert && risk.stageEta !== null && risk.ticketEta !== null
        ? { stageDeadline: risk.stageEta, ticketDue: risk.ticketEta }
        : null,
    newEta: etaDecision.changed ? etaDecision.newEta : null,
  };
}

/**
 * Derive the same signals from before/after ticket state, for callers that
 * only observe the committed result (the Zero side-effect handler). The
 * DETECTED/REOPENED distinction collapses here because both notify
 * identically; what matters is "this is a risk the recipients haven't been
 * told about yet", which the fingerprint change captures exactly - and which
 * also makes this naturally idempotent when one logical mutation produces
 * several `tickets.update` side-effect jobs.
 */
export function etaSignalsFromMetadataDiff(input: {
  previousMetadata: unknown;
  currentMetadata: unknown;
  previousEta: number | null;
  currentEta: number | null;
}): EtaNotificationSignals {
  const prev: TicketEtaManagement = parseTicketEtaManagement(input.previousMetadata);
  const next: TicketEtaManagement = parseTicketEtaManagement(input.currentMetadata);

  const becameActive = next.planningRisk.state === 'ACTIVE';
  const fingerprintChanged = next.planningRisk.fingerprint !== prev.planningRisk.fingerprint;
  const wasAlreadyAlerted = prev.planningRisk.state === 'ACTIVE' && !fingerprintChanged;

  const shouldAlert =
    becameActive &&
    !wasAlreadyAlerted &&
    next.planningRisk.stageEta !== null &&
    next.planningRisk.ticketEta !== null;

  const etaChanged = input.currentEta !== null && input.currentEta !== input.previousEta;

  return {
    riskAlert: shouldAlert
      ? { stageDeadline: next.planningRisk.stageEta!, ticketDue: next.planningRisk.ticketEta! }
      : null,
    newEta: etaChanged ? new Date(input.currentEta!) : null,
  };
}

/**
 * Post-commit notification delivery, per the PRD §8.2 event table:
 *  - planning risk detected/reopened -> action recipients (awareness
 *    recipients who also hold the board's ETA-update permission).
 *  - automatic or manual due-date change -> awareness recipients.
 *  - resolved / unchanged / no date change -> nothing.
 *  - acknowledgment is intentionally NOT handled here (PRD: record + system
 *    message only, no additional notification) - see `ticket.acknowledgeEtaRisk`.
 *
 * Always call this AFTER the mutation has committed - it does its own
 * reads/writes via `notificationService` and must never be able to roll back
 * the ticket mutation on failure.
 */
export async function dispatchEtaNotifications(
  signals: EtaNotificationSignals,
  ctx: DispatchEtaNotificationsContext,
): Promise<void> {
  if (!signals.riskAlert && !signals.newEta) return;

  const awareness = await resolveAwarenessRecipients(ctx.ticketId, ctx.createdBy, ctx.assignedTo, ctx.actorId);

  if (signals.riskAlert) {
    const action = await resolveActionRecipients(awareness, ctx.ticketUserGroupId, ctx.boardId);
    await notificationService.sendPlanningRiskDetectedNotification(ctx.ticketId, action, signals.riskAlert);
  }

  if (signals.newEta) {
    await notificationService.sendTicketDueDateChangedNotification(
      ctx.ticketId,
      awareness,
      signals.newEta.toLocaleDateString(),
      ctx.actorId,
    );
  }
}
