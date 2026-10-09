import { TicketStatusV2 } from '../zero/types.js';

/**
 * Closure bookkeeping for a ticket status change.
 *
 * `closedAt` / `closedBy` record when (and by whom) a ticket entered the
 * COMPLETED status category. Every path that writes `statusV2` must keep them
 * consistent, so the rule lives here once instead of being re-derived per path:
 *
 *   - non-COMPLETED → COMPLETED : stamp closedAt = now, closedBy = actor
 *   - COMPLETED → non-COMPLETED : clear both (reopen, reject, move back, …)
 *   - COMPLETED → COMPLETED     : untouched — a move between two Completed-group
 *                                 stages keeps the original close time
 *   - anything else (incl. CANCELLED) : untouched
 *
 * CANCELLED is deliberately not treated as a closure: "Closed At" reports and
 * team analytics count delivered work, and today's only explicit closedAt
 * writers (release completion, close-ticket automation) only stamp on
 * COMPLETED.
 *
 * Returns the patch to spread into the update, or `{}` when nothing changes.
 * Generic over the timestamp type: Zero writes epoch-ms numbers, Prisma Dates.
 */
export function deriveTicketClosurePatch<T extends number | Date>(
  prevStatus: string | null | undefined,
  nextStatus: string | null | undefined,
  actorId: string | null | undefined,
  now: T,
): { closedAt?: T | null; closedBy?: string | null } {
  if (nextStatus === undefined || nextStatus === null || nextStatus === prevStatus) return {};
  const wasCompleted = prevStatus === TicketStatusV2.COMPLETED;
  const isCompleted = nextStatus === TicketStatusV2.COMPLETED;
  if (isCompleted && !wasCompleted) return { closedAt: now, closedBy: actorId ?? null };
  if (wasCompleted && !isCompleted) return { closedAt: null, closedBy: null };
  return {};
}
