import { ActivityClassification, ApproverType, TicketStageRequestStatus } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, TicketStageRequestPreviousValue } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const LOG_PREFIX = '[StageApprovalNotify]';

/**
 * Side effect handler for ticket_stage_requests.
 *
 * Responsibilities:
 *  - On insert with status=SUBMITTED → notify all stage approvers (the request
 *    is now awaiting their review).
 *  - On update / upsert where status flips into SUBMITTED (e.g., resubmit after
 *    a rejection) → notify approvers again.
 *  - On update / upsert where status flips into APPROVED → notify the submitter.
 *  - On update / upsert where status flips into REJECTED → notify the submitter.
 *
 * Activity-feed entries for these transitions are NOT created here — the
 * mutator (backend/src/zero/mutators.ts → ticketStageRequest.upsert) already
 * emits system messages with ActivityType.STAGE_CHANGE_REQUEST /
 * STAGE_CHANGE_APPROVED / STAGE_CHANGE_REJECTED. This handler is strictly the
 * push-notification half plus per-user `activities` rows for the bell feed.
 *
 * The mutator calls tx.mutate.ticket_stage_requests.upsert(), so the upsert
 * path is the one we care about most. onInsert/onUpdate are kept for symmetry
 * in case Zero ever emits those directly.
 */
export class TicketStageRequestsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    await this.handleAsInsert(job);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    await this.handleAsUpdate(job);
  }

  /**
   * Zero's .upsert() lands here. We branch on previousValue: undefined means
   * the row was just created (insert), defined means an existing row was
   * mutated (update).
   */
  async onUpsert(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as TicketStageRequestPreviousValue | undefined;
    if (prev) {
      await this.handleAsUpdate(job);
    } else {
      await this.handleAsInsert(job);
    }
  }

  private async handleAsInsert(job: SideEffectJobConfig): Promise<void> {
    const request = await db.ticketStageRequest.findUnique({
      where: { id: job.entityId },
      select: {
        id: true,
        ticketId: true,
        stageId: true,
        status: true,
        submittedBy: true,
        updatedBy: true,
      },
    });
    if (!request) {
      logger.warn(`${LOG_PREFIX} insert: request ${job.entityId} not found in DB (skipping)`);
      return;
    }

    if (request.status === TicketStageRequestStatus.SUBMITTED) {
      await this.notifyApprovers(request.stageId, request.ticketId, request.submittedBy);
    }
  }

  private async handleAsUpdate(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as TicketStageRequestPreviousValue | undefined;
    if (!prev) {
      logger.warn(
        `${LOG_PREFIX} update: previousValue missing for request ${job.entityId} (skipping)`,
      );
      return;
    }

    const request = await db.ticketStageRequest.findUnique({
      where: { id: job.entityId },
      select: {
        id: true,
        ticketId: true,
        stageId: true,
        status: true,
        submittedBy: true,
        reviewedBy: true,
        updatedBy: true,
      },
    });
    if (!request) {
      logger.warn(`${LOG_PREFIX} update: request ${job.entityId} not found in DB (skipping)`);
      return;
    }

    // No-op updates (status unchanged) → skip notification entirely.
    if (prev.status === request.status) return;

    switch (request.status) {
      case TicketStageRequestStatus.SUBMITTED:
        await this.notifyApprovers(request.stageId, request.ticketId, request.submittedBy);
        break;
      case TicketStageRequestStatus.APPROVED:
      case TicketStageRequestStatus.REJECTED: {
        const actor = request.reviewedBy ?? request.updatedBy;
        // Self-approval/rejection (edge case) → skip; the user already knows.
        if (actor === request.submittedBy) return;
        await this.notifySubmitter(
          request.submittedBy,
          request.ticketId,
          request.stageId,
          request.status === TicketStageRequestStatus.APPROVED ? 'APPROVED' : 'REJECTED',
          actor,
        );
        break;
      }
      default:
        return;
    }
  }

  private async notifyApprovers(
    stageId: string,
    ticketId: string,
    submittedBy: string,
  ): Promise<void> {
    // Cover both kinds of USER approvers:
    //   1. Stage-level (LINEAR + stage-scoped NON_LINEAR) — keyed by stageId
    //   2. Transition-level (NON_LINEAR edges) — keyed by transitionId on the
    //      edge that connects ticket.currentStage → target stage.
    // The mutator's assertCanReviewStageRequest already considers both, so
    // notifications must too — otherwise transition-level approvers can review
    // but never get told that a request is waiting.

    const stage = await db.stage.findUnique({
      where: { id: stageId },
      select: { name: true, boardId: true },
    });
    const stageName = stage?.name ?? null;

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, channelId: true, stageName: true, boardId: true },
    });

    const stageApprovers = await db.stageApprovers.findMany({
      where: {
        stageId,
        approverType: ApproverType.USER,
        userId: { not: null },
      },
      select: { userId: true },
    });

    // Resolve transition-level approvers: find the edge (currentStage → target)
    // and look up StageApprovers attached to that transitionId. Only meaningful
    // on NON_LINEAR boards; on LINEAR boards no rows exist with transitionId set.
    let transitionApprovers: { userId: string | null }[] = [];
    if (ticket?.stageName && ticket.boardId) {
      const currentStage = await db.stage.findFirst({
        where: { boardId: ticket.boardId, name: ticket.stageName },
        select: { id: true },
      });
      if (currentStage) {
        // Backed by the @@unique([boardId, fromStageId, toStageId]) constraint
        // on StageTransition — use findUnique so Prisma can hit the unique
        // index directly instead of doing a generic scan.
        const transition = await db.stageTransition.findUnique({
          where: {
            boardId_fromStageId_toStageId: {
              boardId: ticket.boardId,
              fromStageId: currentStage.id,
              toStageId: stageId,
            },
          },
          select: { id: true },
        });
        if (transition) {
          transitionApprovers = await db.stageApprovers.findMany({
            where: {
              transitionId: transition.id,
              approverType: ApproverType.USER,
              userId: { not: null },
            },
            select: { userId: true },
          });
        }
      }
    }

    const recipients = Array.from(
      new Set(
        [...stageApprovers, ...transitionApprovers]
          .map(a => a.userId)
          .filter((u): u is string => !!u && u !== submittedBy),
      ),
    );

    if (recipients.length === 0) {
      return;
    }

    await Promise.all(
      recipients.map(async userId => {
        // Per-user activity entry (shows up in the recipient's personal
        // activity feed). Mirror of the ticket-assignments-handler pattern.
        try {
          await activityService.createActivity({
            userId,
            actorId: submittedBy,
            actorAction: 'stage_approval_requested',
            actionSource: 'ticket',
            actionSourceId: ticketId,
            ticketId,
            channelId: ticket?.channelId || undefined,
            classification: ActivityClassification.ACTIONABLE,
          });
        } catch (error) {
          logger.error(
            `${LOG_PREFIX} notifyApprovers: createActivity failed for ${userId} on ticket ${ticketId}:`,
            error,
          );
        }

        try {
          await notificationService.sendStageApprovalNotification(
            userId,
            ticketId,
            'REQUESTED',
            submittedBy,
            stageName,
          );
        } catch (error) {
          logger.error(
            `${LOG_PREFIX} notifyApprovers: failed for ${userId} on ticket ${ticketId}:`,
            error,
          );
        }
      }),
    );
  }

  private async notifySubmitter(
    submittedBy: string,
    ticketId: string,
    stageId: string,
    kind: 'APPROVED' | 'REJECTED',
    actorUserId: string,
  ): Promise<void> {
    const stage = await db.stage.findUnique({
      where: { id: stageId },
      select: { name: true },
    });
    const stageName = stage?.name ?? null;

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, channelId: true },
    });

    // Per-user activity entry for the submitter (shows up in their personal
    // activity feed). FYI classification — they don't need to take action,
    // just be informed of the outcome.
    try {
      const actorAction =
        kind === 'APPROVED' ? 'stage_approval_approved' : 'stage_approval_rejected';
      await activityService.createActivity({
        userId: submittedBy,
        actorId: actorUserId,
        actorAction,
        actionSource: 'ticket',
        actionSourceId: ticketId,
        ticketId,
        channelId: ticket?.channelId || undefined,
        classification: ActivityClassification.FYI,
      });
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifySubmitter: createActivity failed for ${submittedBy} on ticket ${ticketId}:`,
        error,
      );
    }

    try {
      await notificationService.sendStageApprovalNotification(
        submittedBy,
        ticketId,
        kind,
        actorUserId,
        stageName,
      );
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notifySubmitter: failed for ${submittedBy} on ticket ${ticketId}:`,
        error,
      );
    }
  }
}
