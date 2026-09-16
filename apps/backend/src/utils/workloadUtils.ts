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
 */
async function getUserRoleIds(userId: string): Promise<string[]> {
  const [directMappings, groupMappings] = await Promise.all([
    db.userRoleMapping.findMany({
      where: { userId, role: { isActive: true } },
      select: { roleId: true },
    }),
    db.userGroupMapping.findMany({
      where: { userId, roleId: { not: null }, role: { isActive: true } },
      select: { roleId: true },
    }),
  ]);
  const roleIds = new Set<string>();
  for (const m of directMappings) roleIds.add(m.roleId);
  for (const m of groupMappings) if (m.roleId) roleIds.add(m.roleId);
  return Array.from(roleIds);
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
 * Query count is fixed regardless of pool size (board, project roles, role
 * assignments, user roles, tickets, existing rows), and rows whose counts did not
 * change are left untouched — so refreshing on the assignment hot path does not
 * produce no-op writes or no-op Zero pokes.
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

  const projectAssignmentRoleIds = await getProjectAssignmentRoleIds(board.projectId);

  const ticketIdsByRoleId = new Map<string, Set<string>>();
  if (projectAssignmentRoleIds.length > 0) {
    const roleAssignments = await db.ticketAssignment.findMany({
      where: { roleId: { in: projectAssignmentRoleIds } },
      select: { ticketId: true, roleId: true },
    });
    for (const assignment of roleAssignments) {
      if (!assignment.roleId) continue;
      if (!ticketIdsByRoleId.has(assignment.roleId)) ticketIdsByRoleId.set(assignment.roleId, new Set());
      ticketIdsByRoleId.get(assignment.roleId)!.add(assignment.ticketId);
    }
  }

  const [roleIdsByUserId, tickets, existingRows] = await Promise.all([
    resolveUserRoleIds(uniqueUserIds, userRoleIdsByUserId),
    // Counted in memory so the OR between "assigned to me" and "matches my role"
    // dedupes per ticket exactly like the previous per-user COUNT queries did.
    db.ticket.findMany({
      where: { boardId, userGroupId },
      select: { id: true, assignedTo: true, statusV2: true },
    }),
    withWorkspaceScope(() =>
      repositories.userWorkloadMapping.findMany({
        where: { userGroupId, boardId, userId: { in: uniqueUserIds } },
      }),
    ),
  ]);

  const existingByUserId = new Map(existingRows.map(row => [row.userId, row]));

  for (const userId of uniqueUserIds) {
    const userRoleIds = roleIdsByUserId.get(userId) ?? [];
    const workloadRoleIds = projectAssignmentRoleIds.filter(id => userRoleIds.includes(id));
    const roleMatchedTicketIds = new Set<string>();
    for (const roleId of workloadRoleIds) {
      for (const ticketId of ticketIdsByRoleId.get(roleId) ?? []) roleMatchedTicketIds.add(ticketId);
    }

    let activeTasks = 0;
    let totalTasks = 0;
    for (const ticket of tickets) {
      if (ticket.assignedTo !== userId && !roleMatchedTicketIds.has(ticket.id)) continue;
      totalTasks += 1;
      if (ticket.statusV2 === TicketStatusV2.TODO || ticket.statusV2 === TicketStatusV2.STARTED) {
        activeTasks += 1;
      }
    }

    const existing = existingByUserId.get(userId);
    if (existing && existing.activeTasks === activeTasks && existing.totalTasks === totalTasks) {
      continue;
    }

    // Writes the row of the assignee rather than the caller, so it runs above the caller's own scope.
    await withWorkspaceScope(() =>
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
    );
  }
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
 */
export async function handleTicketAssignmentChange(
  newAssignedTo: string | null,
  oldAssignedTo: string | null,
  userGroupId: string,
  boardId: string,
  updatedBy: string
): Promise<void> {
  // Sync workload for old assignee (if exists)
  if (oldAssignedTo && oldAssignedTo !== newAssignedTo) {
    try {
      await syncUserWorkload(oldAssignedTo, userGroupId, boardId, updatedBy);
      logger.info(`[Workload Sync] Updated workload for old assignee ${oldAssignedTo}`);
    } catch (error) {
      logger.error(`[Workload Sync] Error syncing workload for old assignee:`, error);
    }
  }

  // Sync workload for new assignee (if exists)
  if (newAssignedTo && newAssignedTo !== oldAssignedTo) {
    try {
      await syncUserWorkload(newAssignedTo, userGroupId, boardId, updatedBy);
      logger.info(`[Workload Sync] Updated workload for new assignee ${newAssignedTo}`);
    } catch (error) {
      logger.error(`[Workload Sync] Error syncing workload for new assignee:`, error);
    }
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
