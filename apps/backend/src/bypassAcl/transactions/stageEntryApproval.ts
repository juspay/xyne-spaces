import { transaction } from '../base';
import { db } from '@/database/client';
import { Prisma } from '@prisma/client';
import { ActivityType, MessageType, TicketStageRequestStatus } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { lockTicketStageName } from '@/bypassAcl/rowLockServices';



export function maybeCreateEntryApprovalRequestTx(ticket: any, targetStageId: string, landedStageName: string, targetStageName: string | null, actorId: string, actorName: any) {
  return transaction(['Ticket', 'TicketStageRequest'], 'maybeCreateEntryApprovalRequest: locks the ticket row and creates the stage-entry approval request atomically so two concurrent moves cannot both create one; tx is not ACL-wrapped', db, tx =>
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
export async function claimEntryApprovalRequest(
  tx: Prisma.TransactionClient,
  ticket: { id: string; conversationId: string; workspaceId: string },
  stageId: string,
  landedStageName: string,
  targetStageName: string | null,
  actorId: string,
  actorName: string,
): Promise<boolean> {
  const row = await lockTicketStageName(tx, ticket.id);
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
      workspaceId: ticket.workspaceId,
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
