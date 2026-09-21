import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { handleTicketAssignmentChange } from '@/utils/workloadUtils';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { UserStatus } from '@xyne/shared';
import { logger } from './logger';
import type { TicketLike } from '@/automations/triggers/ticket-context';
// Safe as a value import: the trigger module reaches this one only through a lazy
// import(), so nothing closes the loop at module-load time.
import {
  isTicketReopenTransition,
  type TicketChanges,
} from '@/automations/triggers/ticket-updated.trigger';

const prisma = DatabaseClient.getInstance();

/**
 * The ticket fields needed to pick a replacement assignee. Kept to a narrow shape
 * so callers can pass a `select`ed row rather than a full ticket.
 */
export interface ReassignableTicket {
  id: string;
  boardId: string;
  projectId: string;
  channelId: string;
  workspaceId: string;
  userGroupId: string;
}

/**
 * Move one ticket off `excludeUserId` and onto the best remaining candidate.
 *
 * Single implementation of "re-run auto-assignment for this ticket, but not onto
 * this person" — used by both the bulk reassignment queue (a member going
 * unavailable / leaving) and the reopen guard (a completed ticket coming back to
 * life while its assignee is deactivated). Keeping one copy matters here: every
 * divergent copy of this sequence in the codebase so far has been missing a step
 * (a workload sync, an activity emit), which is what pinned assignment to one
 * user in XYNE-55777.
 *
 * Returns the new assignee's userId, or null when nothing changed — either no
 * eligible replacement exists or the engine could only offer the excluded user.
 * In that case the ticket keeps its current assignee rather than being nulled
 * out: an unavailable owner is still more useful than no owner.
 */
export async function reassignTicketAwayFrom(
  ticket: ReassignableTicket,
  excludeUserId: string,
): Promise<string | null> {
  const result = await evaluateAssignmentRule(
    ticket.userGroupId,
    ticket.boardId,
    AssignmentType.TICKET_ASSIGNEE,
    excludeUserId,
    ticket.projectId,
    ticket.channelId,
  );

  if (!result.assignedUserId) {
    logger.info(
      `[TICKET-REASSIGNMENT] No eligible replacement for ticket ${ticket.id} (${result.reason}); leaving assignee unchanged`,
    );
    return null;
  }

  const systemActorId = await getAutomationsBotUserId(ticket.workspaceId);
  await repositories.tickets.updateTicketAssignee(ticket.id, result.assignedUserId, systemActorId);
  await handleTicketAssignmentChange(
    result.assignedUserId,
    excludeUserId,
    ticket.userGroupId,
    ticket.boardId,
    systemActorId,
  );

  return result.assignedUserId;
}

/**
 * Re-run auto-assignment when a completed ticket is reopened onto a deactivated
 * assignee.
 *
 * A member leaving hands off their *open* tickets only — a completed ticket needs
 * no owner, so it is deliberately left alone at departure time. Reopening it is
 * the moment that stops being true: the work is live again and its owner no longer
 * exists. Checking here rather than sweeping at departure also covers tickets
 * completed long before the departure, with no backfill required.
 *
 * Fire-and-forget by design: reassignment must never block or fail the status
 * change that triggered it.
 */
export async function reassignReopenedTicketIfAssigneeInactive(
  ticket: TicketLike,
  changes: TicketChanges,
): Promise<void> {
  try {
    // Re-checked here, not just at the call site, so the guard holds for any future
    // caller of this function.
    if (!isTicketReopenTransition(changes)) return;

    // Nothing to re-route: an unassigned or ungrouped ticket has no stale owner to
    // replace, and without a group there is no candidate pool to pick from.
    const currentAssigneeId = ticket.assignedTo;
    if (!currentAssigneeId || !ticket.userGroupId) return;

    const assignee = await prisma.user.findUnique({
      where: { id: currentAssigneeId },
      select: { status: true },
    });

    if (assignee?.status !== UserStatus.INACTIVE) return;

    const newAssigneeId = await reassignTicketAwayFrom(
      {
        id: ticket.id,
        boardId: ticket.boardId,
        projectId: ticket.projectId,
        channelId: ticket.channelId,
        workspaceId: ticket.workspaceId,
        userGroupId: ticket.userGroupId,
      },
      currentAssigneeId,
    );

    if (newAssigneeId) {
      logger.info(
        `[TICKET-REASSIGNMENT] Reopened ticket ${ticket.id} moved off deactivated user ${currentAssigneeId} → ${newAssigneeId}`,
      );
    }
  } catch (error) {
    logger.error(
      `[TICKET-REASSIGNMENT] Reopen reassignment check failed for ticket ${ticket.id}:`,
      error,
    );
  }
}
