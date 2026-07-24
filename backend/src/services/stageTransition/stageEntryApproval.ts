import {
  ActivityClassification,
  ActivityType,
  ApproverType,
  BoardType,
  FormContextType,
  MessageType,
  Prisma,
  TicketStageRequestStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const LOG_PREFIX = '[StageApprovalNotify]';

/** Resolved "who to auto-request approval from" for the stage a ticket just entered. */
interface EntryTarget {
  stageId: string;
  stageName: string | null;
  approversWhere: { transitionId: string } | { stageId: string };
}

/**
 * When a ticket lands on a stage, auto-create the approval request for the
 * next stage in line — but only if that next stage is configured with
 * `requestApprovalOnEntry`. This surfaces the approve/reject request and
 * notifies the approver as soon as the ticket enters the PREVIOUS stage, with
 * no manual move required.
 *
 * Board-type specific resolution (see resolveNonLinearEntryTarget /
 * resolveLinearEntryTarget for the exact guards of each):
 *   - NON_LINEAR: the entered stage's single outgoing StageTransition, gated
 *     on requiresApproval && requestApprovalOnEntry.
 *   - DEFAULT (linear): the next stage by sequenceNumber, gated on its own
 *     requestApprovalOnEntry flag (approval itself is implicit — signaled by
 *     that stage having approvers configured at all).
 * Both additionally skip when the target has a form attached (a form must be
 * filled manually) and when there's already a pending (SUBMITTED) request for
 * the target stage.
 *
 * Best-effort: invoked fire-and-forget from every landing path. Prisma writes
 * don't fire the ticket_stage_requests side effect (only Zero tx.mutate writes
 * do), so this path reproduces what that mutator would have done — the
 * conversation system message, the approver activity entries, and the push
 * notifications — directly.
 *
 * `landedStageName` must be the stage the *triggering* update actually landed
 * the ticket on (known synchronously by every caller). We re-read the ticket
 * below anyway (for boardId/channelId/etc.), but only act if its *current*
 * stageName still matches — otherwise a rapid A→B→C sequence could have this
 * (delayed, fire-and-forget) call for "landed on B" run after a later update
 * already moved the ticket to C, causing it to evaluate approval requirements
 * for C using B's invocation instead of bailing out and letting C's own
 * landing invocation (which fires independently) handle it.
 */
export async function maybeCreateEntryApprovalRequest(
  ticketId: string,
  actorId: string,
  landedStageName: string,
): Promise<void> {
  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        boardId: true,
        channelId: true,
        conversationId: true,
        workspaceId: true,
        stageName: true,
        isArchived: true,
      },
    });
    if (!ticket || ticket.isArchived || !ticket.stageName) return;
    // Stale invocation — the ticket has since moved past the stage this call
    // was triggered for. The invocation for its current stage handles it.
    if (ticket.stageName !== landedStageName) return;

    const board = await db.board.findUnique({
      where: { id: ticket.boardId },
      select: { boardType: true },
    });
    if (!board) return;

    const target =
      board.boardType === BoardType.NON_LINEAR
        ? await resolveNonLinearEntryTarget(ticket)
        : board.boardType === BoardType.DEFAULT
          ? await resolveLinearEntryTarget(ticket)
          : null; // RELEASE boards don't follow strict sequenceNumber order — not supported.
    if (!target) return;

    const { stageId: targetStageId, stageName: targetStageName, approversWhere } = target;

    // Resolve the actor's display name up front (read-only) so it can be
    // written into the system message inside the same transaction as the
    // claim below, shrinking the window between "request persisted" and
    // "audit message persisted" to a single commit.
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const actorName = actor?.name || 'Someone';

    let claimed: boolean;
    try {
      claimed = await db.$transaction(tx =>
        claimEntryApprovalRequest(
          tx,
          ticket,
          targetStageId,
          landedStageName,
          targetStageName,
          actorId,
          actorName,
        ),
      );
    } catch (error) {
      // A concurrent invocation raced us to INSERT the same (ticketId, stageId)
      // row and committed first — Postgres aborts *our* transaction outright
      // (no partial state persists). That's benign: the winner notifies.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
    // Already SUBMITTED (by a prior call or a concurrent winner) — don't
    // duplicate the audit message or re-notify.
    if (!claimed) return;

    await notifyEntryApprovers(approversWhere, ticket, targetStageName, actorId);
  } catch (error) {
    // Never let an auto-entry failure break the transition that triggered it.
    logger.error(
      `${LOG_PREFIX} maybeCreateEntryApprovalRequest failed for ticket ${ticketId}:`,
      error,
    );
  }
}

/**
 * Atomically claim the (ticketId, stageId) approval request and, if won, write
 * the audit system message in the same transaction — so a crash between the
 * two is impossible: either both persist, or neither does, and the next
 * landing invocation gets a clean retry.
 *
 * Postgres upsert (INSERT ... ON CONFLICT DO UPDATE) always "succeeds" — it
 * never raises the unique-violation a plain create+catch would, so it can't be
 * used to detect a concurrent winner. We read first to pick the right branch,
 * then either INSERT (fresh row) or a conditional UPDATE scoped to
 * `status != SUBMITTED` (re-arming an old row), using the affected row count
 * to tell whether *this* call is the one that won.
 *
 * Deliberately does NOT try/catch the INSERT's potential unique-violation
 * here: Prisma's interactive transactions don't implicitly savepoint each
 * statement, so a failed query would abort the whole underlying Postgres
 * transaction and any further query on `tx` would fail too. Letting the error
 * propagate (caller catches it around the `$transaction` call) cleanly rolls
 * back this transaction instead — correct, since losing that race means this
 * call should be a no-op.
 *
 * Re-validates `landedStageName` against the ticket row's *current* value
 * under `FOR UPDATE` before claiming anything. The caller's own check (top of
 * `maybeCreateEntryApprovalRequest`) only guards the window up to that read —
 * the board/target-resolution queries and the actor lookup that run
 * afterwards are further async gaps in which a rapid A→B→C could move the
 * ticket off `landedStageName` before we get here. Locking the row also means
 * we block on (and then see the result of) any concurrent transaction that's
 * mid-UPDATE on this same ticket, rather than racing it.
 */
async function claimEntryApprovalRequest(
  tx: Prisma.TransactionClient,
  ticket: { id: string; conversationId: string; workspaceId: string | null },
  stageId: string,
  landedStageName: string,
  targetStageName: string | null,
  actorId: string,
  actorName: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ stageName: string }[]>`
    SELECT "stageName" FROM "tickets" WHERE "id" = ${ticket.id} FOR UPDATE
  `;
  if (!row || row.stageName !== landedStageName) return false;

  const existing = await tx.ticketStageRequest.findUnique({
    where: { ticketId_stageId: { ticketId: ticket.id, stageId } },
    select: { status: true },
  });

  let won: boolean;
  if (!existing) {
    await tx.ticketStageRequest.create({
      data: {
        ticketId: ticket.id,
        stageId,
        status: TicketStageRequestStatus.SUBMITTED,
        submittedBy: actorId,
        updatedBy: actorId,
        workspaceId: ticket.workspaceId,
      },
    });
    won = true;
  } else if (existing.status === TicketStageRequestStatus.SUBMITTED) {
    won = false;
  } else {
    // Re-arm an APPROVED/REJECTED row from a prior visit. The status guard
    // means at most one concurrent updateMany can affect the row: the loser's
    // WHERE no longer matches once the winner's UPDATE commits.
    const { count } = await tx.ticketStageRequest.updateMany({
      where: { ticketId: ticket.id, stageId, status: { not: TicketStageRequestStatus.SUBMITTED } },
      data: {
        status: TicketStageRequestStatus.SUBMITTED,
        submittedBy: actorId,
        reviewedBy: null,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
    });
    won = count === 1;
  }
  if (!won) return false;

  // Mirror the ticketStageRequest.upsert mutator: post a system message in the
  // ticket thread so channel participants see the request there, not only in
  // the approver activity feed / push.
  await tx.message.create({
    data: {
      messageId: randomUUID(),
      conversationId: ticket.conversationId,
      senderId: actorId,
      ...(ticket.workspaceId ? { workspaceId: ticket.workspaceId } : {}),
      content: `${actorName} requested approval for ${targetStageName ?? ''}`.trim(),
      msgType: MessageType.SYSTEM,
      showInChannel: false,
      metadata: {
        activityType: ActivityType.STAGE_CHANGE_REQUEST,
        isTicketActivity: true,
        fromStage: landedStageName,
        toStage: targetStageName,
        hasForm: false,
      } as Prisma.InputJsonValue,
    },
  });
  return true;
}

/**
 * NON_LINEAR: only auto-fire when the entered stage has exactly one outgoing
 * transition (multi-exit stages stay manual — we can't guess which branch to
 * request), that transition requires approval + is opted into on-entry, and
 * it has no form attached (a form must be filled manually).
 */
async function resolveNonLinearEntryTarget(ticket: {
  boardId: string;
  stageName: string | null;
}): Promise<EntryTarget | null> {
  const enteredStage = await db.stage.findFirst({
    where: { boardId: ticket.boardId, name: ticket.stageName as string },
    select: { id: true },
  });
  if (!enteredStage) return null;

  const outgoing = await db.stageTransition.findMany({
    where: { boardId: ticket.boardId, fromStageId: enteredStage.id },
    select: {
      id: true,
      toStageId: true,
      formId: true,
      requiresApproval: true,
      requestApprovalOnEntry: true,
    },
  });
  if (outgoing.length !== 1) return null;

  const transition = outgoing[0];
  if (!transition.requiresApproval || !transition.requestApprovalOnEntry) return null;
  if (transition.formId) return null;

  const targetStage = await db.stage.findUnique({
    where: { id: transition.toStageId },
    select: { name: true },
  });
  return {
    stageId: transition.toStageId,
    stageName: targetStage?.name ?? null,
    approversWhere: { transitionId: transition.id },
  };
}

/**
 * Linear (DEFAULT) boards move strictly forward by sequenceNumber, so there's
 * no multi-exit ambiguity to guard — the next stage is unambiguous. Approval
 * itself is implicit (signaled by the next stage having approvers configured
 * at all, same convention as the manual TicketDetails.tsx gate), so this also
 * requires at least one StageApprovers row — otherwise a request would be
 * created that nobody could ever approve.
 */
async function resolveLinearEntryTarget(ticket: {
  boardId: string;
  stageName: string | null;
}): Promise<EntryTarget | null> {
  const enteredStage = await db.stage.findFirst({
    where: { boardId: ticket.boardId, name: ticket.stageName as string },
    select: { sequenceNumber: true },
  });
  if (!enteredStage) return null;

  const nextStage = await db.stage.findFirst({
    where: { boardId: ticket.boardId, sequenceNumber: { gt: enteredStage.sequenceNumber } },
    orderBy: { sequenceNumber: 'asc' },
    select: { id: true, name: true, requestApprovalOnEntry: true },
  });
  if (!nextStage || !nextStage.requestApprovalOnEntry) return null;

  // A form must be filled manually — auto-entry is only for no-action stages.
  const formMapping = await db.formContextMapping.findFirst({
    where: { contextId: nextStage.id, contextType: FormContextType.STAGE },
    select: { id: true },
  });
  if (formMapping) return null;

  const approverCount = await db.stageApprovers.count({ where: { stageId: nextStage.id } });
  if (approverCount === 0) return null;

  return {
    stageId: nextStage.id,
    stageName: nextStage.name,
    approversWhere: { stageId: nextStage.id },
  };
}

/**
 * Notify the target's approvers that an on-entry request is waiting — the
 * same activity + push pair the ticket_stage_requests side effect emits for a
 * normally-submitted request (which, being Prisma-created here, doesn't fire).
 * `approversWhere` selects transition-level (NON_LINEAR) or stage-level
 * (linear) approvers — StageApprovers.stageId/transitionId are mutually
 * exclusive columns on the same table. ROLE approvers are fanned out to their
 * member users.
 */
async function notifyEntryApprovers(
  approversWhere: { transitionId: string } | { stageId: string },
  ticket: { id: string; channelId: string | null },
  stageName: string | null,
  submittedBy: string,
): Promise<void> {
  const approverRows = await db.stageApprovers.findMany({
    where: approversWhere,
    select: { userId: true, roleId: true, approverType: true },
  });

  // NULL approverType is treated as USER (legacy rows).
  const userIds = approverRows
    .filter(a => (a.approverType ?? ApproverType.USER) === ApproverType.USER && a.userId)
    .map(a => a.userId as string);
  const roleIds = approverRows
    .filter(a => a.approverType === ApproverType.ROLE && a.roleId)
    .map(a => a.roleId as string);

  const memberIds = await resolveRoleMemberUserIds(roleIds);

  const recipients = Array.from(
    new Set([...userIds, ...memberIds].filter(u => u && u !== submittedBy)),
  );

  await Promise.all(
    recipients.map(async userId => {
      try {
        await activityService.createActivity({
          userId,
          actorId: submittedBy,
          actorAction: 'stage_approval_requested',
          actionSource: 'ticket',
          actionSourceId: ticket.id,
          ticketId: ticket.id,
          channelId: ticket.channelId || undefined,
          classification: ActivityClassification.ACTIONABLE,
        });
        await notificationService.sendStageApprovalNotification(
          userId,
          ticket.id,
          'REQUESTED',
          submittedBy,
          stageName,
        );
      } catch (error) {
        logger.error(
          `${LOG_PREFIX} notifyEntryApprovers failed for ${userId} on ticket ${ticket.id}:`,
          error,
        );
      }
    }),
  );
}

/**
 * Resolve ROLE approver roleIds to the set of member user IDs, covering both
 * direct role mappings and group-based role mappings (mirrors the membership
 * checks in ticketStageTransitionService). No shared utility exists for this
 * role → members direction today.
 */
async function resolveRoleMemberUserIds(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const [directMembers, groupMembers] = await Promise.all([
    db.userRoleMapping.findMany({ where: { roleId: { in: roleIds } }, select: { userId: true } }),
    db.userGroupMapping.findMany({ where: { roleId: { in: roleIds } }, select: { userId: true } }),
  ]);
  return Array.from(
    new Set([...directMembers.map(m => m.userId), ...groupMembers.map(m => m.userId)]),
  );
}
