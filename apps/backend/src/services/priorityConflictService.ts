import { PrismaClient } from '@prisma/client';
// Imported from source rather than the package root: @xyne/shared resolves to ESM `dist`,
// which the CommonJS Jest runner cannot require, and this module is under unit test.
import {
  ActivityClassification,
  TicketPriority,
  TicketStatusV2,
} from '../../../../packages/shared/src/zero/types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const LOG_PREFIX = '[PriorityConflict]';

// Type for Prisma transaction client
type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Priority queue placement + conflict negotiation.
 *
 * Opt-in per channel via `channels.priorityConflictEnabled`. When a channel has opted in:
 *  - every ticket must carry a requested ETA;
 *  - a HIGH/CRITICAL ticket MAY additionally name an existing task it should go ahead of. Naming
 *    one is optional: without it the ticket just joins the back of the priority queue. With one,
 *    the raiser must justify it and the ticket stays BLOCKED until that task's owner accepts.
 *
 * There is deliberately no "reject" action. The superseded owner is never asked to say no —
 * leaving a claim unanswered is what keeps the new ticket blocked. Only the raiser can move
 * things along, by withdrawing the claim and pointing at a different task (which loops that
 * next owner in) or by lowering the priority.
 */

// Must stay in sync with NEGOTIATED_PRIORITIES / SUPERSEDABLE_STATUSES in
// packages/shared/src/utils/priorityConflict.ts, which the Zero claim mutator (the
// post-creation escalation entry point) enforces. Duplicated rather than imported because
// @xyne/shared is ESM and this module is loaded by the CommonJS Jest runner.

/** Priorities that contend for a place in the queue and so trigger the negotiation. */
const NEGOTIATED_PRIORITIES: ReadonlySet<string> = new Set([
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
]);

/** Ticket states that still represent live work, and so can be jumped ahead of. */
const SUPERSEDABLE_STATUSES: string[] = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
];

export interface PriorityConflictIntake {
  /** An existing task this one should go ahead of. Optional — without it the ticket joins the
   *  back of the priority queue and no claim is raised. */
  supersededTicketId?: string;
  /** Why this task should go first. Required once `supersededTicketId` is set, because it is
   *  shown to that task's owner when they are asked to agree. */
  supersedeJustification?: string;
}

export class PriorityConflictValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'PriorityConflictValidationError';
    this.field = field;
  }
}

export class PriorityConflictService {
  /** Whether the channel has opted into the structured intake flow. */
  async isEnabledForChannel(channelId: string | undefined | null): Promise<boolean> {
    if (!channelId) {
      return false;
    }
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { priorityConflictEnabled: true },
    });
    return channel?.priorityConflictEnabled === true;
  }

  /** True when this priority contends for a place in the queue. */
  requiresSupersede(priority: string | undefined): boolean {
    return !!priority && NEGOTIATED_PRIORITIES.has(priority);
  }

  /**
   * Validates the intake payload for an opted-in channel. Throws
   * PriorityConflictValidationError (mapped to a 400 by the caller) on the first problem so the
   * raiser gets one actionable message at a time.
   *
   * Returns the resolved respondent for a supersede claim, or null when no claim is needed.
   * Callers must have already validated that `eta` is present.
   */
  async validateIntake(params: {
    channelId: string;
    priority: string | undefined;
    raiserId: string;
    intake: PriorityConflictIntake;
  }): Promise<{ respondentId: string; supersededTicketId: string } | null> {
    const { channelId, priority, raiserId, intake } = params;

    if (!this.requiresSupersede(priority)) {
      return null;
    }

    // Naming a task to jump ahead of is optional. Without one the ticket simply joins the back
    // of the priority queue — no claim, no block, nobody to wait on.
    const supersededTicketId = intake.supersededTicketId?.trim();
    if (!supersededTicketId) {
      return null;
    }
    // Once a task IS named, its owner will be asked to agree, so they need the reasoning.
    if (!intake.supersedeJustification?.trim()) {
      throw new PriorityConflictValidationError(
        'Explain why this task should go ahead of the one you picked.',
        'supersedeJustification',
      );
    }

    const superseded = await db.ticket.findUnique({
      where: { id: supersededTicketId },
      select: {
        id: true,
        channelId: true,
        assignedTo: true,
        createdBy: true,
        statusV2: true,
        isArchived: true,
      },
    });

    // Archived is folded into "no longer exists" here purely for a friendlier message; the Zero
    // claim mutator rejects the same rows via `isArchived || !isSupersedableStatus`. Both paths
    // accept exactly the set {not archived} ∩ {TODO, STARTED, PAUSED} — see the drift test in
    // src/test/priorityConflictService.test.ts.
    if (!superseded || superseded.isArchived) {
      throw new PriorityConflictValidationError(
        'The task you are trying to supersede no longer exists.',
        'supersededTicketId',
      );
    }
    if (superseded.channelId !== channelId) {
      throw new PriorityConflictValidationError(
        'You can only supersede a task in the same channel.',
        'supersededTicketId',
      );
    }
    if (!SUPERSEDABLE_STATUSES.includes(superseded.statusV2)) {
      throw new PriorityConflictValidationError(
        'That task is already closed — pick a task that is still in progress.',
        'supersededTicketId',
      );
    }

    // Whoever owns the work has to accept; fall back to its raiser when unassigned so a claim
    // always has a named respondent to wait on.
    const respondentId = superseded.assignedTo ?? superseded.createdBy;
    if (respondentId === raiserId) {
      throw new PriorityConflictValidationError(
        'You cannot supersede your own task — pick a task owned by someone else.',
        'supersededTicketId',
      );
    }

    return { respondentId, supersededTicketId };
  }

  /**
   * Records the opening PENDING claim for a freshly created ticket. Call inside the ticket
   * creation transaction so a ticket can never be left high-priority without its blocking claim.
   */
  async createClaim(
    params: {
      ticketId: string;
      supersededTicketId: string;
      channelId: string;
      workspaceId: string;
      justification: string;
      raiserId: string;
      respondentId: string;
    },
    tx: PrismaTransaction | typeof db = db,
  ): Promise<{ id: string }> {
    const claim = await tx.priorityConflictClaim.create({
      data: {
        ticketId: params.ticketId,
        supersededTicketId: params.supersededTicketId,
        channelId: params.channelId,
        workspaceId: params.workspaceId,
        state: 'PENDING',
        justification: params.justification,
        raisedBy: params.raiserId,
        respondentId: params.respondentId,
      },
      select: { id: true },
    });

    logger.info(
      `${LOG_PREFIX} ticket ${params.ticketId} blocked pending acceptance by ${params.respondentId} (claim ${claim.id})`,
    );
    return claim;
  }

  /**
   * Loops the superseded task's owner in on a claim raised through the REST create path.
   *
   * The Zero side-effect handler covers claims raised through Zero mutators, but ticket creation
   * is a REST write that Zero never sees — without this the respondent would never learn their
   * task is being superseded, and the ticket would sit blocked on someone who was never asked.
   *
   * Call AFTER the creation transaction commits: a notification for a rolled-back ticket is
   * worse than a late one. Never throws — a failed notification must not fail ticket creation.
   *
   * The respondent is reached two independent ways, which is what stops a blocked ticket from
   * stalling silently:
   *  1. An ACTIONABLE activity row. activityService does NOT apply notification filtering, so
   *     this lands in their feed even when they have muted the channel or paused notifications.
   *  2. A push/desktop notification, which IS filtered (global pause or channel NONE suppress
   *     it) and is therefore best-effort only.
   *
   * If (1) fails the respondent may never learn of the claim, so that path logs at ERROR with a
   * WARN summary carrying the ids needed to re-drive it by hand. There is no automatic retry —
   * worth adding a dead-letter/retry job if this ever fires in practice.
   */
  async notifyClaimRaised(params: {
    ticketId: string;
    supersededTicketId: string;
    channelId: string;
    raiserId: string;
    respondentId: string;
  }): Promise<void> {
    if (params.respondentId === params.raiserId) {
      return;
    }

    try {
      await activityService.createActivity({
        userId: params.respondentId,
        actorId: params.raiserId,
        actorAction: 'priority_conflict_raised',
        actionSource: 'ticket',
        actionSourceId: params.ticketId,
        ticketId: params.ticketId,
        channelId: params.channelId || undefined,
        classification: ActivityClassification.ACTIONABLE,
      });
    } catch (error) {
      // The unfiltered surface failed, so the respondent may have no idea they are blocking a
      // ticket. Emit a structured WARN alongside the error so this is alertable and can be
      // re-driven manually.
      logger.warn(
        `${LOG_PREFIX} respondent NOT notified — ticket stays blocked with nobody aware`,
        {
          ticketId: params.ticketId,
          supersededTicketId: params.supersededTicketId,
          respondentId: params.respondentId,
          raiserId: params.raiserId,
        },
      );
      logger.error(
        `${LOG_PREFIX} createActivity failed for ${params.respondentId} on ticket ${params.ticketId}:`,
        error,
      );
    }

    try {
      await notificationService.sendPriorityConflictNotification(
        params.respondentId,
        params.ticketId,
        'RAISED',
        params.raiserId,
        params.supersededTicketId,
      );
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} notification failed for ${params.respondentId} on ticket ${params.ticketId}:`,
        error,
      );
    }
  }

  /**
   * Whether a ticket is currently blocked awaiting acceptance.
   * Accepted once, always unblocked — later withdrawals do not re-block a ticket.
   */
  async isTicketBlocked(ticketId: string): Promise<boolean> {
    // Two indexed existence checks on (ticketId, state) rather than loading every claim —
    // an append-only history can grow with each re-pick.
    const accepted = await db.priorityConflictClaim.findFirst({
      where: { ticketId, state: 'ACCEPTED' },
      select: { id: true },
    });
    if (accepted) {
      return false;
    }

    const pending = await db.priorityConflictClaim.findFirst({
      where: { ticketId, state: 'PENDING' },
      select: { id: true },
    });
    return !!pending;
  }
}

export const priorityConflictService = new PriorityConflictService();
