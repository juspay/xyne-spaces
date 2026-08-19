import { db } from '@/database/client';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';
import { canUserModifyTicketControl } from './etaPermissions';

/**
 * Same "who might care about this ticket" set every existing
 * `sendTicket*Notification` method in notificationService.ts already uses
 * (see `TicketsSideEffectHandler`'s private `fetchTicketActors` in
 * zero/side-effects/tables/tickets-handler.ts, reimplemented here rather
 * than exported cross-module for a single shared call).
 */
async function fetchTicketActors(ticketId: string): Promise<string[]> {
  const [roleAssignments, formFieldUserActors] = await Promise.all([
    db.ticketAssignment.findMany({ where: { ticketId }, select: { userId: true } }),
    getFormFieldUserActors(ticketId),
  ]);
  return roleAssignments
    .map((a) => a.userId)
    .filter((id): id is string => Boolean(id))
    .concat(formFieldUserActors);
}

/**
 * "Awareness recipients" (PRD §8.1): assignee, creator, active ticket
 * assignments, and user-valued ticket fields. Notification-preference
 * filtering (mute/pause/channel level) happens separately in the actual
 * send methods (`notificationFilterService`), not here.
 */
export async function resolveAwarenessRecipients(
  ticketId: string,
  createdBy: string,
  assignedTo: string | null,
  excludeUserId?: string,
): Promise<string[]> {
  const extraActors = await fetchTicketActors(ticketId);
  const all = [createdBy, assignedTo, ...extraActors].filter(
    (id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index,
  );
  return excludeUserId ? all.filter((id) => id !== excludeUserId) : all;
}

/**
 * "Action recipients" (PRD §8.1): awareness recipients who also satisfy the
 * board's ETA-update permission policy. This is a net-new concept - no
 * existing recipient-resolution function in this codebase filters by
 * permission, only by notification preference (mute/pause/channel level).
 */
export async function resolveActionRecipients(
  awarenessRecipients: string[],
  ticketUserGroupId: string | null,
  boardId: string,
): Promise<string[]> {
  if (!ticketUserGroupId || awarenessRecipients.length === 0) {
    // No user group on the ticket: canUserModifyTicketControl's underlying gate is
    // unrestricted for everyone in that case, so the full awareness set qualifies.
    return awarenessRecipients;
  }

  const board = await db.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
  const results = await Promise.all(
    awarenessRecipients.map(async (userId) => {
      const permission = await canUserModifyTicketControl(userId, ticketUserGroupId, boardId, {
        getBoardMetadata: async () => board?.metadata ?? null,
        getUserGroupMapping: async (uid, ugId) => {
          const mapping = await db.userGroupMapping.findFirst({
            where: { userId: uid, userGroupId: ugId },
          });
          return mapping
            ? { roleId: mapping.roleId ?? null, responsibility: mapping.responsibility ?? null }
            : null;
        },
      });
      return permission.allowed ? userId : null;
    }),
  );
  return results.filter((id): id is string => id !== null);
}
