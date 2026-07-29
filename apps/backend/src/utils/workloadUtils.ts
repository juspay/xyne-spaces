import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { TicketStatusV2 } from '@prisma/client';
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
  const board = await db.board.findUnique({
    where: { id: boardId },
    select: { projectId: true, workspaceId: true },
  });
  if (!board) {
    logger.warn(`[Workload Sync] Board ${boardId} not found; skipping workload sync`);
    return;
  }

  const [projectAssignmentRoleIds, resolvedUserRoleIds] = await Promise.all([
    getProjectAssignmentRoleIds(board.projectId),
    userRoleIds !== undefined ? Promise.resolve(userRoleIds) : getUserRoleIds(userId),
  ]);
  const workloadRoleIds = projectAssignmentRoleIds.filter(id => resolvedUserRoleIds.includes(id));

  let roleMatchedTicketIds: string[] = [];
  if (workloadRoleIds.length > 0) {
    const roleAssignments = await db.ticketAssignment.findMany({
      where: { roleId: { in: workloadRoleIds } },
      select: { ticketId: true },
    });
    roleMatchedTicketIds = Array.from(new Set(roleAssignments.map(ta => ta.ticketId)));
  }

  const ticketWhere = {
    boardId: boardId,
    userGroupId: userGroupId,
    OR: [
      { assignedTo: userId },
      ...(roleMatchedTicketIds.length > 0 ? [{ id: { in: roleMatchedTicketIds } }] : []),
    ],
  };

  const [activeTasks, totalTasks] = await Promise.all([
    db.ticket.count({
      where: { ...ticketWhere, statusV2: { in: [TicketStatusV2.TODO, TicketStatusV2.STARTED] } },
    }),
    db.ticket.count({ where: ticketWhere }),
  ]);

  await repositories.userWorkloadMapping.upsert({
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
  });
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
