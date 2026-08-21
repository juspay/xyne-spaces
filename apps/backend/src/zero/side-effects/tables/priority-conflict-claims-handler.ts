import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification, PriorityConflictState } from '@xyne/shared';
import type { PriorityConflictClaimPreviousValue, SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const LOG_PREFIX = '[PriorityConflictNotify]';

/**
 * Side effect handler for priority_conflict_claims.
 *
 * Responsibilities:
 *  - On insert (state=PENDING) → loop in the owner of the superseded task. Their acceptance is
 *    the only thing that unblocks the raiser's ticket.
 *  - On update into ACCEPTED → tell the raiser their ticket is unblocked.
 *
 * WITHDRAWN is deliberately silent: the raiser withdrew their own claim, and the respondent was
 * never obliged to act on it. A re-pick inserts a fresh claim, which notifies the next owner
 * through the insert path above.
 *
 * Claims raised through the REST create path never reach Zero, so priorityConflictService
 * notifies directly there. This handler covers the Zero mutator path (post-creation escalation).
 */
export class PriorityConflictClaimsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const claim = await this.loadClaim(job.entityId);
    if (!claim) return;

    if (claim.state === PriorityConflictState.PENDING) {
      await this.notifyRespondent(claim);
    }
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as PriorityConflictClaimPreviousValue | undefined;
    const claim = await this.loadClaim(job.entityId);
    if (!claim) return;

    // No-op updates (state unchanged) → nothing to announce.
    if (prev && prev.state === claim.state) return;

    if (claim.state === PriorityConflictState.ACCEPTED) {
      await this.notifyRaiser(claim);
    }
  }

  private async loadClaim(id: string) {
    const claim = await db.priorityConflictClaim.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        supersededTicketId: true,
        channelId: true,
        state: true,
        raisedBy: true,
        respondentId: true,
        respondedBy: true,
      },
    });
    if (!claim) {
      logger.warn(`${LOG_PREFIX} claim ${id} not found in DB (skipping)`);
      return null;
    }
    return claim;
  }

  /** The superseded task's owner has to accept before the raiser's ticket can move. */
  private async notifyRespondent(claim: {
    id: string;
    ticketId: string;
    supersededTicketId: string;
    channelId: string;
    raisedBy: string;
    respondentId: string;
  }): Promise<void> {
    if (claim.respondentId === claim.raisedBy) return;

    try {
      await activityService.createActivity({
        userId: claim.respondentId,
        actorId: claim.raisedBy,
        actorAction: 'priority_conflict_raised',
        actionSource: 'ticket',
        actionSourceId: claim.ticketId,
        ticketId: claim.ticketId,
        channelId: claim.channelId || undefined,
        classification: ActivityClassification.ACTIONABLE,
      });
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifyRespondent: createActivity failed for ${claim.respondentId} on ticket ${claim.ticketId}:`,
        error,
      );
    }

    try {
      await notificationService.sendPriorityConflictNotification(
        claim.respondentId,
        claim.ticketId,
        'RAISED',
        claim.raisedBy,
        claim.supersededTicketId,
      );
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifyRespondent: failed for ${claim.respondentId} on ticket ${claim.ticketId}:`,
        error,
      );
    }
  }

  /** Their claim was accepted — the ticket is unblocked. */
  private async notifyRaiser(claim: {
    id: string;
    ticketId: string;
    supersededTicketId: string;
    channelId: string;
    raisedBy: string;
    respondedBy: string | null;
  }): Promise<void> {
    const actorId = claim.respondedBy ?? claim.raisedBy;
    // Self-acceptance shouldn't be reachable (the mutator blocks it), but skip it defensively.
    if (actorId === claim.raisedBy) return;

    try {
      await activityService.createActivity({
        userId: claim.raisedBy,
        actorId,
        actorAction: 'priority_conflict_accepted',
        actionSource: 'ticket',
        actionSourceId: claim.ticketId,
        ticketId: claim.ticketId,
        channelId: claim.channelId || undefined,
        classification: ActivityClassification.FYI,
      });
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifyRaiser: createActivity failed for ${claim.raisedBy} on ticket ${claim.ticketId}:`,
        error,
      );
    }

    try {
      await notificationService.sendPriorityConflictNotification(
        claim.raisedBy,
        claim.ticketId,
        'ACCEPTED',
        actorId,
        claim.supersededTicketId,
      );
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifyRaiser: failed for ${claim.raisedBy} on ticket ${claim.ticketId}:`,
        error,
      );
    }
  }
}
