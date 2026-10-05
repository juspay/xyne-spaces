import { DatabaseClient } from '@/database/client';
import { TicketStatusV2 } from '@xyne/shared';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from './logger';
import type { AssignmentCandidate } from './assignmentEngine';

const db = DatabaseClient.getInstance();

/** Which tickets received in the window count toward a member's share. */
export type PercentageShareBasis = 'ALL' | 'OPEN';

/** The resolved % share settings for one board: where the current window starts and what counts. */
export interface ShareWindowConfig {
  windowStart: Date;
  basis: PercentageShareBasis;
}

const OPEN_STATUSES: string[] = [TicketStatusV2.TODO, TicketStatusV2.STARTED];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start of the share window that contains `now`. Windows are fixed, back-to-back periods of
 * `windowDays` counted from `windowStartAt`, so counts reset to zero at each boundary rather
 * than sliding.
 */
export function currentShareWindowStart(
  windowStartAt: Date,
  windowDays: number,
  now: number = Date.now(),
): Date {
  const start = windowStartAt.getTime();
  if (now <= start) return windowStartAt;
  const length = windowDays * DAY_MS;
  return new Date(start + Math.floor((now - start) / length) * length);
}

/**
 * The board's % share settings, or null when any of them is missing. There are no defaults:
 * an incompletely configured board is assigned by standard workload scoring instead.
 */
export function resolveShareWindowConfig(
  score:
    | {
        percentageWindowDays: number | null;
        percentageShareBasis: string | null;
        percentageWindowStartAt: Date | null;
      }
    | undefined,
  boardId: string,
  userGroupId: string,
): ShareWindowConfig | null {
  const windowDays = score?.percentageWindowDays ?? null;
  const basis = score?.percentageShareBasis ?? null;
  const startAt = score?.percentageWindowStartAt ?? null;
  if (windowDays === null || windowDays < 1 || (basis !== 'ALL' && basis !== 'OPEN') || startAt === null) {
    logger.info(
      `[Assignment] %-share: board ${boardId} for userGroupId ${userGroupId} is missing share window settings (days=${windowDays}, basis=${basis}, startAt=${startAt?.toISOString() ?? null}); using workload scoring`,
    );
    return null;
  }
  return { windowStart: currentShareWindowStart(startAt, windowDays), basis };
}

/**
 * Distinct tickets on (boardId, userGroupId) assigned to each user since `since` (the start
 * of the current share window).
 *
 * Two sources, unioned per ticket so a ticket is never counted twice for the same user:
 * - ASSIGNED_TO activities, so a ticket keeps counting for whoever received it even after
 *   it is manually moved on (otherwise handing tickets away would earn more of them);
 * - tickets created in the window whose current assignee is the user, which covers the
 *   assignment paths that do not write an activity row.
 * With basis OPEN, only tickets still TODO/STARTED count, so closing one frees up share.
 */
export async function countRecentAssignmentsByUser(
  boardId: string,
  userGroupId: string,
  userIds: string[],
  since: Date,
  basis: PercentageShareBasis,
): Promise<Map<string, number>> {
  const openOnly = basis === 'OPEN';
  const pool = new Set(userIds);
  const ticketsByUser = new Map<string, Set<string>>(userIds.map(id => [id, new Set<string>()]));

  const [activities, tickets] = await Promise.all([
    withWorkspaceScope(() =>
      db.ticketActivity.findMany({
        where: {
          activityType: 'ASSIGNED_TO',
          timestamp: { gte: since },
          ticket: {
            boardId,
            userGroupId,
            ...(openOnly && { statusV2: { in: OPEN_STATUSES } }),
          },
        },
        select: { ticketId: true, value: true },
      }),
    ),
    withWorkspaceScope(() =>
      db.ticket.findMany({
        where: {
          boardId,
          userGroupId,
          createdAt: { gte: since },
          assignedTo: { in: userIds },
          ...(openOnly && { statusV2: { in: OPEN_STATUSES } }),
        },
        select: { id: true, assignedTo: true },
      }),
    ),
  ]);

  for (const activity of activities) {
    const newValue = (activity.value as { newValue?: unknown } | null)?.newValue;
    if (typeof newValue === 'string' && pool.has(newValue)) {
      ticketsByUser.get(newValue)!.add(activity.ticketId);
    }
  }
  for (const ticket of tickets) {
    if (ticket.assignedTo && pool.has(ticket.assignedTo)) {
      ticketsByUser.get(ticket.assignedTo)!.add(ticket.id);
    }
  }

  return new Map(Array.from(ticketsByUser, ([userId, ids]) => [userId, ids.size]));
}

/**
 * Orders candidates for a % share board so the member furthest below their target share
 * comes first. Returns null when the share rule cannot apply (no positive targets, or the
 * counts could not be read) so the caller falls back to standard workload scoring.
 *
 * Targets are rescaled over the members actually in the pool, so an inactive member's share
 * is redistributed. deficit = share × (N + 1) − assigned, where N is the pool's total
 * assignments in the window: the classic "who is owed the next ticket" apportionment, which
 * converges to the configured ratio (40/40/20 → A, B, C, A, B, …). Ties go to lower open load.
 * Members with a 0% target come last in their original score order, so they only receive a
 * ticket when every positive-target member is skipped by a cap.
 */
export async function rankCandidatesByShare(params: {
  candidates: AssignmentCandidate[];
  boardId: string;
  userGroupId: string;
  windowStart: Date;
  basis: PercentageShareBasis;
  targetPercentOf: (userId: string) => number;
}): Promise<AssignmentCandidate[] | null> {
  const { candidates, boardId, userGroupId, windowStart, basis, targetPercentOf } = params;

  const withTarget = candidates.filter(c => targetPercentOf(c.userId) > 0);
  if (withTarget.length === 0) {
    logger.info(
      `[Assignment] %-share: no member with a positive share on board ${boardId} for userGroupId ${userGroupId}; using workload scoring`,
    );
    return null;
  }

  let counts: Map<string, number>;
  try {
    counts = await countRecentAssignmentsByUser(
      boardId,
      userGroupId,
      withTarget.map(c => c.userId),
      windowStart,
      basis,
    );
  } catch (error) {
    logger.error(
      `[Assignment] %-share: failed to count assignments for board ${boardId}, userGroupId ${userGroupId}; using workload scoring`,
      error,
    );
    return null;
  }

  const targetTotal = withTarget.reduce((sum, c) => sum + targetPercentOf(c.userId), 0);
  const assignedTotal = withTarget.reduce((sum, c) => sum + (counts.get(c.userId) ?? 0), 0);

  const ranked = withTarget.map(c => {
    const share = targetPercentOf(c.userId) / targetTotal;
    const assigned = counts.get(c.userId) ?? 0;
    const deficit = share * (assignedTotal + 1) - assigned;
    const openLoad = Number(c.details?.weightedActiveTasks ?? 0);
    return { ...c, details: { ...c.details, share, assignedInWindow: assigned, deficit, openLoad } };
  });
  ranked.sort(
    (a, b) =>
      b.details.deficit - a.details.deficit ||
      a.details.openLoad - b.details.openLoad ||
      a.userId.localeCompare(b.userId),
  );

  const zeroTarget = candidates
    .filter(c => targetPercentOf(c.userId) <= 0)
    .sort((a, b) => a.score - b.score);

  logger.info(
    `[Assignment] %-share ranking for board ${boardId}, userGroupId ${userGroupId}, window since ${windowStart.toISOString()}, basis ${basis}, counted ${assignedTotal}: ${ranked
      .map(
        c =>
          `${c.userId}(share=${(c.details.share * 100).toFixed(1)}%, assigned=${c.details.assignedInWindow}, deficit=${c.details.deficit.toFixed(2)})`,
      )
      .join(' ')}`,
  );

  return [...ranked, ...zeroTarget];
}
