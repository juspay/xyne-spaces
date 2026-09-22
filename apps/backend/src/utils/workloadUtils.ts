import { DatabaseClient } from '@/database/client';
import { TicketStatusV2 } from '@xyne/shared';
import { withWorkspaceScope } from '@/database/tenant/context';
import { repositories } from '@/database/repositories';
import { logger } from './logger';

const db = DatabaseClient.getInstance();

/**
 * Collect every unique roleId configured in `metadata.assignmentRoles` across
 * all boards in the given project. Returns an empty array if no board has the
 * config set.
 */
async function getProjectAssignmentRoleIds(projectId: string): Promise<string[]> {
  const boards = await db.board.findMany({
    where: { projectId },
    select: { metadata: true },
  });
  const roleIds = new Set<string>();
  for (const board of boards) {
    const metadata = board.metadata as { assignmentRoles?: Array<{ roleId: string }> } | null;
    if (Array.isArray(metadata?.assignmentRoles)) {
      for (const slot of metadata!.assignmentRoles!) {
        if (slot?.roleId) roleIds.add(slot.roleId);
      }
    }
  }
  return Array.from(roleIds);
}

/**
 * All roleIds the user currently holds, unioned across both binding tables:
 *   - user_role_mappings (direct)
 *   - user_group_mappings.roleId (via group)
 *
 * Single-user form of {@link resolveUserRoleIds}, which owns the rule — keeping
 * a second copy here is how the two would drift apart.
 */
async function getUserRoleIds(userId: string): Promise<string[]> {
  return (await resolveUserRoleIds([userId])).get(userId) ?? [];
}

/**
 * Sync UserWorkloadMapping for a specific user on a specific board.
 *
 * A ticket counts toward the user's workload on this board if:
 *   - it is directly assigned to the user (ticket.assignedTo === userId), OR
 *   - the user holds a role (via user_role_mappings or user_group_mappings.roleId)
 *     that matches any roleId in `metadata.assignmentRoles` of any board in the
 *     same project as this board.
 * activeTasks further restricts to statusV2 IN (TODO, STARTED).
 *
 * Callers that sync multiple boards for the same user (e.g.
 * `syncUserWorkloadAllBoards`) should pass pre-fetched `userRoleIds` to avoid
 * re-querying the user's roles on every iteration.
 */
export async function syncUserWorkload(
  userId: string,
  userGroupId: string,
  boardId: string,
  createdBy: string,
  userRoleIds?: string[],
): Promise<void> {
  await syncWorkloadForUsers(
    [userId],
    userGroupId,
    boardId,
    createdBy,
    userRoleIds !== undefined ? new Map([[userId, userRoleIds]]) : undefined,
  );
}

/**
 * All roleIds held by each of the given users, in one pair of queries.
 * Pre-resolved entries in `provided` are used as-is (callers that already know a
 * user's roles should pass them, exactly as the single-user path allowed).
 */
async function resolveUserRoleIds(
  userIds: string[],
  provided?: Map<string, string[]>,
): Promise<Map<string, string[]>> {
  const resolved = new Map<string, string[]>();
  const missing: string[] = [];
  for (const userId of userIds) {
    const preResolved = provided?.get(userId);
    if (preResolved !== undefined) resolved.set(userId, preResolved);
    else missing.push(userId);
  }
  if (missing.length === 0) return resolved;

  const [directMappings, groupMappings] = await Promise.all([
    db.userRoleMapping.findMany({
      where: { userId: { in: missing }, role: { isActive: true } },
      select: { userId: true, roleId: true },
    }),
    db.userGroupMapping.findMany({
      where: { userId: { in: missing }, roleId: { not: null }, role: { isActive: true } },
      select: { userId: true, roleId: true },
    }),
  ]);

  const roleIdsByUserId = new Map<string, Set<string>>(missing.map(id => [id, new Set<string>()]));
  for (const mapping of directMappings) roleIdsByUserId.get(mapping.userId)?.add(mapping.roleId);
  for (const mapping of groupMappings) {
    if (mapping.roleId) roleIdsByUserId.get(mapping.userId)?.add(mapping.roleId);
  }
  for (const [userId, roleIds] of roleIdsByUserId) resolved.set(userId, Array.from(roleIds));
  return resolved;
}

/**
 * Bulk form of {@link syncUserWorkload} and the single implementation of the
 * workload counting rules — the single-user function delegates here.
 *
 * Counting semantics are unchanged: a ticket counts toward a user's workload on
 * this board when it is directly assigned to them, or when it carries a role
 * assignment for a role they hold that is configured in `metadata.assignmentRoles`
 * of any board in the project. `activeTasks` further restricts to
 * statusV2 IN (TODO, STARTED).
 *
 * Query count is fixed regardless of pool size, and the directly-assigned counts are
 * aggregated by the database rather than transferred row by row — this runs on the
 * assignment hot path, so the volume it reads must not scale with board history.
 * Rows whose counts did not change are left untouched, and a candidate with no work
 * gets no row at all, so a refresh over a settled pool writes nothing.
 */
export async function syncWorkloadForUsers(
  userIds: string[],
  userGroupId: string,
  boardId: string,
  createdBy: string,
  userRoleIdsByUserId?: Map<string, string[]>,
): Promise<void> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  const board = await db.board.findUnique({
    where: { id: boardId },
    select: { projectId: true, workspaceId: true },
  });
  if (!board) {
    logger.warn(`[Workload Sync] Board ${boardId} not found; skipping workload sync`);
    return;
  }

  // Nothing here depends on anything else here, so it all goes in one round trip.
  // Only the role-assignment read below needs a result from it.
  //
  // The directly-assigned side is counted by the database, not in Node. This runs on
  // the assignment hot path (every evaluate* call refreshes its candidate pool), so
  // materialising a board's whole ticket set here would put an unbounded transfer in
  // front of every ticket creation.
  const [projectAssignmentRoleIds, roleIdsByUserId, directCounts, existingRows] = await Promise.all([
    getProjectAssignmentRoleIds(board.projectId),
    resolveUserRoleIds(uniqueUserIds, userRoleIdsByUserId),
    db.ticket.groupBy({
      by: ['assignedTo', 'statusV2'],
      where: { boardId, userGroupId, assignedTo: { in: uniqueUserIds } },
      _count: { _all: true },
    }),
    withWorkspaceScope(() =>
      repositories.userWorkloadMapping.findMany({
        where: { userGroupId, boardId, userId: { in: uniqueUserIds } },
      }),
    ),
  ]);

  const isActiveStatus = (statusV2: string): boolean =>
    statusV2 === TicketStatusV2.TODO || statusV2 === TicketStatusV2.STARTED;

  type Counts = { activeTasks: number; totalTasks: number };
  const countsByUserId = new Map<string, Counts>(
    uniqueUserIds.map(id => [id, { activeTasks: 0, totalTasks: 0 }]),
  );
  for (const row of directCounts) {
    if (!row.assignedTo) continue;
    const counts = countsByUserId.get(row.assignedTo);
    if (!counts) continue;
    const n = row._count._all;
    counts.totalTasks += n;
    if (isActiveStatus(row.statusV2)) counts.activeTasks += n;
  }

  // Role-matched tickets are added on top. Scoped to this board through the relation
  // filter — the old per-user COUNT reached the same set because its ticket predicate
  // carried boardId/userGroupId, so narrowing here preserves the semantics while
  // keeping the scan proportional to role-assigned tickets rather than all of them.
  if (projectAssignmentRoleIds.length > 0) {
    const roleAssignments = await db.ticketAssignment.findMany({
      where: {
        roleId: { in: projectAssignmentRoleIds },
        ticket: { boardId, userGroupId },
      },
      select: { ticketId: true, roleId: true },
    });

    if (roleAssignments.length > 0) {
      const roleTickets = await db.ticket.findMany({
        where: { id: { in: Array.from(new Set(roleAssignments.map(a => a.ticketId))) } },
        select: { id: true, assignedTo: true, statusV2: true },
      });
      const roleTicketById = new Map(roleTickets.map(t => [t.id, t]));

      const ticketIdsByRoleId = new Map<string, Set<string>>();
      for (const assignment of roleAssignments) {
        if (!assignment.roleId) continue;
        if (!ticketIdsByRoleId.has(assignment.roleId)) ticketIdsByRoleId.set(assignment.roleId, new Set());
        ticketIdsByRoleId.get(assignment.roleId)!.add(assignment.ticketId);
      }

      for (const userId of uniqueUserIds) {
        const userRoleIds = roleIdsByUserId.get(userId) ?? [];
        const counts = countsByUserId.get(userId)!;
        const seen = new Set<string>();
        for (const roleId of projectAssignmentRoleIds) {
          if (!userRoleIds.includes(roleId)) continue;
          for (const ticketId of ticketIdsByRoleId.get(roleId) ?? []) {
            if (seen.has(ticketId)) continue;
            seen.add(ticketId);
            const ticket = roleTicketById.get(ticketId);
            // Already counted on the directly-assigned side; the original OR
            // counted such a ticket once, so it must not be added twice.
            if (!ticket || ticket.assignedTo === userId) continue;
            counts.totalTasks += 1;
            if (isActiveStatus(ticket.statusV2)) counts.activeTasks += 1;
          }
        }
      }
    }
  }

  const existingByUserId = new Map(existingRows.map(row => [row.userId, row]));

  const changed: Array<{ userId: string; activeTasks: number; totalTasks: number }> = [];
  for (const userId of uniqueUserIds) {
    const { activeTasks, totalTasks } = countsByUserId.get(userId)!;
    const existing = existingByUserId.get(userId);

    if (existing) {
      if (existing.activeTasks === activeTasks && existing.totalTasks === totalTasks) continue;
    } else if (activeTasks === 0 && totalTasks === 0) {
      // Never create an empty row. Beyond saving a pointless write and Zero poke, the
      // absence of a row is load-bearing: resolveStartOffsets treats "has no workload
      // row" as "new to this group" and gives that member a starting offset so they
      // are not flooded to catch up with established peers. Creating 0/0 rows for
      // every candidate at evaluation time would erase that signal permanently.
      continue;
    }

    changed.push({ userId, activeTasks, totalTasks });
  }

  // One row per user, each on its own composite key, so the writes are
  // independent and go out together rather than one round trip at a time.
  // Every withWorkspaceScope call opens its own AsyncLocalStorage scope, so
  // running them concurrently does not let one scope leak into another.
  await Promise.all(
    changed.map(({ userId, activeTasks, totalTasks }) =>
      // Writes the row of the assignee rather than the caller, so it runs above the caller's own scope.
      withWorkspaceScope(() =>
        repositories.userWorkloadMapping.upsert({
          where: {
            userId_userGroupId_boardId: {
              userId,
              userGroupId,
              boardId,
            },
          },
          create: {
            userId,
            userGroupId,
            boardId,
            workspaceId: board.workspaceId,
            activeTasks,
            totalTasks,
            createdBy,
          },
          update: {
            activeTasks,
            totalTasks,
          },
        }),
      ),
    ),
  );
}

/**
 * Sync workload for a user across all boards in a user group
 * Useful when reassigning tickets or bulk updates
 */
export async function syncUserWorkloadAllBoards(
  userId: string,
  userGroupId: string,
  createdBy: string
): Promise<void> {
  // Get all boards this user has tickets on
  const tickets = await db.ticket.findMany({
    where: {
      assignedTo: userId,
      userGroupId: userGroupId,
    },
    select: {
      boardId: true,
    },
    distinct: ['boardId'],
  });

  const boardIds = tickets.map((t: any) => t.boardId);
  if (boardIds.length === 0) return;
  const userRoleIds = await getUserRoleIds(userId);

  // Sync workload for each board
  for (const boardId of boardIds) {
    await syncUserWorkload(userId, userGroupId, boardId, createdBy, userRoleIds);
  }
}

/**
 * Handle ticket assignment/reassignment change
 * Syncs workload for both old and new assignees
 *
 * Both sides go through one bulk sync rather than a call each. The reassignment
 * queue invokes this once per ticket across a departing member's whole backlog, so
 * a second pass here doubled the per-ticket query cost for no benefit.
 */
export async function handleTicketAssignmentChange(
  newAssignedTo: string | null,
  oldAssignedTo: string | null,
  userGroupId: string,
  boardId: string,
  updatedBy: string
): Promise<void> {
  if (oldAssignedTo === newAssignedTo) return;

  const affectedUserIds = [oldAssignedTo, newAssignedTo].filter(
    (id): id is string => Boolean(id),
  );
  if (affectedUserIds.length === 0) return;

  try {
    await syncWorkloadForUsers(affectedUserIds, userGroupId, boardId, updatedBy);
    logger.info(`[Workload Sync] Updated workload for ${affectedUserIds.join(', ')}`);
  } catch (error) {
    logger.error(`[Workload Sync] Error syncing workload after assignment change:`, error);
  }
}

/**
 * Handle ticket status change
 * Syncs workload for the assigned user (activeTasks count changes)
 */
export async function handleTicketStatusChange(
  assignedTo: string | null,
  userGroupId: string,
  boardId: string,
  updatedBy: string
): Promise<void> {
  if (!assignedTo) {
    return; // No one to sync workload for
  }

  try {
    await syncUserWorkload(assignedTo, userGroupId, boardId, updatedBy);
    logger.info(`[Workload Sync] Updated workload after status change for user ${assignedTo}`);
  } catch (error) {
    logger.error(`[Workload Sync] Error syncing workload after status change:`, error);
  }
}
