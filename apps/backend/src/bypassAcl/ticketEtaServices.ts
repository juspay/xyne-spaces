import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { parseTicketEtaManagement, mergeTicketEtaManagement } from '@xyne/shared';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import {
  buildRiskTransitionActivityIntents,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  type evaluatePlanningRisk,
} from '@/services/etaManagement';
import { ActivityType } from '@xyne/shared';
import { createEtaSystemMessage } from '@/utils/etaNotificationUtils';
import { lockTicketMetadata } from './rowLockServices';
import { asService } from './base';

/**
 * Relocated from workers/stageEtaDeadlineWorker.ts's evaluateTicket. Re-checks the persisted
 * planning-risk fingerprint under a row lock and writes in the same transaction, so an
 * overlapping run or a retry cannot pass the check and then both write. Cron worker → no
 * request context, workspace comes from the ticket being evaluated. Resolves false when the
 * fingerprint changed under us (another run already handled it).
 */
export function commitStageEtaDecision(input: {
  ticket: { id: string; eta: Date | null; workspaceId: string; channelId: string | null };
  stageId: string;
  decision: ReturnType<typeof evaluatePlanningRisk>;
  previousFingerprint: string | null;
  systemActorId: string;
}): Promise<boolean> {
  const { ticket, stageId, decision, previousFingerprint, systemActorId } = input;
  return asService(
    ['Ticket', 'TicketActivity'],
    'stage eta deadline worker: row-locked fingerprint re-check and write, cron job has no request context',
    'stage-eta-deadline-worker',
    ticket.workspaceId,
    async () =>
    db.$transaction(async tx => {
      const locked = await lockTicketMetadata(tx, ticket.id);
      const freshRisk = parseTicketEtaManagement(locked?.metadata).planningRisk;
      if (freshRisk.fingerprint !== previousFingerprint) {
        return false;
      }

      const mergedMetadata = mergeTicketEtaManagement(locked?.metadata, {
        planningRisk: decision.nextState,
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { metadata: mergedMetadata as Prisma.InputJsonValue },
      });

      const intents = buildRiskTransitionActivityIntents(decision, {
        currentStageId: stageId,
        oldEta: ticket.eta ? ticket.eta.getTime() : null,
        trigger: 'RECONCILIATION',
        systemReason: 'Hourly reconciliation detected a planning-risk state change',
        previousRiskFingerprint: previousFingerprint,
      });
      for (const intent of intents) {
        await recordTicketTimelineEvent(
          {
            activity: {
              ticketId: ticket.id,
              updatedBy: systemActorId,
              activityType: intent.activityType,
              value: intent.value as Prisma.InputJsonValue,
              workspaceId: ticket.workspaceId,
              channelId: ticket.channelId,
            },
          },
          tx,
        );
      }
      return true;
    })
  );
}

/**
 * Relocated from workers/stageEtaDeadlineWorker.ts's evaluateTicket. Post-commit notification
 * dispatch, same tenant scope as the commit above — only the run that won the lock reaches here.
 */
export function dispatchStageEtaNotifications(
  ticket: {
    id: string;
    workspaceId: string;
    createdBy: string | null;
    assignedTo: string | null;
    userGroupId: string | null;
    boardId: string;
  },
  decision: ReturnType<typeof evaluatePlanningRisk>,
  systemActorId: string,
) {
  return asService(
    ['Ticket', 'TicketActivity'],
    'stage eta deadline worker: post-commit notification dispatch for the run that won the lock',
    'stage-eta-deadline-worker',
    ticket.workspaceId,
    () =>
      dispatchEtaNotifications(
        etaSignalsFromResult({ etaDecision: { newEta: null, changed: false }, planningRisk: decision }),
        {
          ticketId: ticket.id,
          createdBy: ticket.createdBy ?? systemActorId,
          assignedTo: ticket.assignedTo,
          ticketUserGroupId: ticket.userGroupId,
          boardId: ticket.boardId,
          actorId: systemActorId,
        },
      ),
  );
}

/**
 * Relocated from workers/etaDeadlineWorker.ts's checkBreaches. Multi-workspace cron → open a
 * per-ticket tenant context so the system message's workspaceId gets stamped from this ticket's
 * workspace.
 */
export function createEtaBreachSystemMessage(input: {
  workspaceId: string;
  conversationId: string;
  content: string;
  createdAt: Date;
}) {
  const { workspaceId, conversationId, content, createdAt } = input;
  return asService(
    ['Message', 'Ticket'],
    'eta deadline worker: multi-workspace cron, system message stamped from this ticket\'s own workspace',
    'eta-deadline-worker',
    workspaceId,
    () =>
      createEtaSystemMessage({
        conversationId,
        content,
        createdAt,
        activityType: ActivityType.ETA,
      }),
  );
}
